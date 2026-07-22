import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0'
import { corsHeaders } from './cors.ts'
import { fetchWithTimeout } from '../_shared/fetch.ts'

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const DEFAULT_SITE_URL = 'https://portal.ekvproject.cz'

const getSiteUrl = (supabaseUrl: string) => {
  const raw = Deno.env.get('SITE_URL') || Deno.env.get('VITE_SITE_URL') || DEFAULT_SITE_URL
  if (!raw || raw.includes('.supabase.co')) return DEFAULT_SITE_URL
  return raw.replace(/\/$/, '')
}

const normalizeEmail = (email?: string) => (email || '').trim().toLowerCase()

const buildUpdatePasswordUrl = (siteUrl: string, linkData: Record<string, any>, type = 'recovery') => {
  const tokenHash = linkData?.properties?.hashed_token || linkData?.properties?.token_hash
  if (!tokenHash) return linkData?.properties?.action_link
  const params = new URLSearchParams({ token_hash: tokenHash, type })
  return `${siteUrl}/update-password?${params.toString()}`
}

const brandedEmail = ({ title, intro, ctaLabel, ctaUrl, note }: { title: string; intro: string; ctaLabel: string; ctaUrl: string; note?: string }) => `
  <div style="margin:0;padding:0;background:#f4f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #dbe4f0;border-radius:20px;overflow:hidden;box-shadow:0 18px 48px rgba(15,23,42,.08)">
        <div style="padding:26px 30px;border-bottom:1px solid #e5edf7;background:linear-gradient(135deg,#f8fbff,#eef5ff)">
          <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;color:#1d4ed8">EKV Portal</div>
          <div style="margin-top:6px;font-size:13px;color:#64748b">Bezpečný přístup do firemního portálu</div>
        </div>
        <div style="padding:30px">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#0f172a">${title}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569">${intro}</p>
          <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:12px;padding:13px 20px">${ctaLabel}</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b">${note || 'Pokud jste tuto akci nečekali, kontaktujte administrátora portálu.'}</p>
        </div>
      </div>
    </div>
  </div>
`

const sendBrandedEmailDirect = async (to: string, subject: string, htmlContent: string) => {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL') || 'EKV Portal <portal@web.ekvproject.cz>'

  if (!resendApiKey) {
    throw new Error('Email server is not configured.')
  }

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject,
      html: htmlContent,
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to send email: ${details}`)
  }

  return response.json()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    const siteUrl = getSiteUrl(supabaseUrl)

    const { action, payload = {} } = await req.json()

    if (action === 'request_password_reset') {
      const email = normalizeEmail(payload.email)
      if (!email) return jsonResponse({ error: 'Chybí e-mail.' }, 400)

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${siteUrl}/update-password` },
      })

      if (linkError) {
        const message = linkError.message?.toLowerCase() || ''
        if (message.includes('not found') || message.includes('user not')) {
          return jsonResponse({ sent: true })
        }
        throw linkError
      }

      await sendBrandedEmailDirect(email, 'Obnova hesla do EKV Portal', brandedEmail({
        title: 'Obnova hesla',
        intro: 'Požádali jste o bezpečné nastavení nového hesla do EKV Portal.',
        ctaLabel: 'Změnit heslo',
        ctaUrl: buildUpdatePasswordUrl(siteUrl, linkData as Record<string, any>),
        note: 'Pokud jste o obnovu hesla nežádali, tento e-mail ignorujte nebo kontaktujte administrátora.',
      }))

      return jsonResponse({ sent: true })
    }
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !authUser) {
      return jsonResponse({ error: `Authentication error: ${userError?.message || 'unknown user'}` }, 401)
    }

    const authenticatedSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: adminRoleData, error: roleError } = await authenticatedSupabase.rpc('get_user_role')
    if (roleError) {
      console.error('Role check error:', roleError)
      return jsonResponse({ error: 'Could not verify user role.' }, 500)
    }

    const isAdmin = adminRoleData === 'admin'
    const actorEmail = authUser.email || authUser.user_metadata?.full_name || authUser.id

    const logAdminAction = async (adminAction: string, targetUserId: string | null, targetEmail: string | null, beforeState: unknown, afterState: unknown, details: Record<string, unknown> = {}) => {
      const { error } = await supabaseAdmin.from('audit_logs').insert({
        user_id: authUser.id,
        user_email: authUser.email || null,
        action: `admin_${adminAction}`,
        details: {
          actor_email: actorEmail,
          target_user_id: targetUserId,
          target_email: targetEmail,
          before: beforeState,
          after: afterState,
          ...details,
        },
      })
      if (error) console.error('Audit log failed:', error)
    }

    const sendEmail = async (to: string, subject: string, htmlContent: string) => {
      const { data, error } = await authenticatedSupabase.functions.invoke('send-email', {
        body: JSON.stringify({ to, subject, htmlContent }),
      })
      if (error) throw error
      return data
    }

    if (action === 'list_users') {
      if (!isAdmin) return jsonResponse({ error: 'Access denied' }, 403)

      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      if (listError) throw listError

      const { data: members, error: membersError } = await supabaseAdmin
        .from('members')
        .select('id, auth_user_id, user_role, name, email')
      if (membersError) throw membersError

      const { data: statuses, error: statusesError } = await supabaseAdmin
        .from('user_account_status')
        .select('auth_user_id, status, reason, deactivated_at, reactivated_at')
      if (statusesError && statusesError.code !== '42P01') throw statusesError

      const { data: userRoles, error: userRolesError } = await supabaseAdmin
        .from('user_roles')
        .select('role_name')
        .order('role_name')
      if (userRolesError) throw userRolesError

      const memberMap = new Map((members || []).filter((m) => m.auth_user_id).map((m) => [m.auth_user_id, m]))
      const statusMap = new Map((statuses || []).map((s) => [s.auth_user_id, s]))

      const usersWithDetails = users.map((u) => {
        const member = memberMap.get(u.id)
        const statusRow = statusMap.get(u.id)
        const accountStatus = statusRow?.status === 'disabled'
          ? 'disabled'
          : u.email_confirmed_at
            ? 'active'
            : 'invited'

        return {
          ...u,
          role: member?.user_role || null,
          member_id: member?.id || null,
          member_name: member?.name || null,
          is_member: !!member,
          account_status: accountStatus,
          account_status_reason: statusRow?.reason || null,
          user_metadata: {
            ...u.user_metadata,
            role: member?.user_role || null,
          },
        }
      })

      return jsonResponse({ users: usersWithDetails, roles: (userRoles || []).map((r) => r.role_name) })
    }

    if (!isAdmin) return jsonResponse({ error: 'Access denied: Admin role required for this action.' }, 403)

    const upsertAccountStatus = async (userId: string, status: 'active' | 'disabled', reason?: string) => {
      const payload = status === 'disabled'
        ? { auth_user_id: userId, status, reason: reason || null, deactivated_at: new Date().toISOString(), deactivated_by: authUser.id }
        : { auth_user_id: userId, status, reason: null, reactivated_at: new Date().toISOString(), reactivated_by: authUser.id }

      const { data, error } = await supabaseAdmin
        .from('user_account_status')
        .upsert(payload, { onConflict: 'auth_user_id' })
        .select()
        .single()
      if (error) throw error
      return data
    }

    switch (action) {
      case 'invite_user': {
        const email = normalizeEmail(payload.email)
        const fullName = String(payload.full_name || '').trim()
        const role = payload.role || 'user'
        const memberId = payload.member_id || null
        if (!email || !fullName) return jsonResponse({ error: 'Vyplňte jméno a e-mail.' }, 400)

        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: {
            data: { full_name: fullName },
            redirectTo: `${siteUrl}/update-password`,
          },
        })
        if (linkError) {
          if (linkError.message?.toLowerCase().includes('already')) {
            return jsonResponse({ error: 'Uživatel s tímto e-mailem již existuje.' }, 409)
          }
          throw linkError
        }

        const invitedUser = linkData.user
        if (memberId) {
          const { error } = await supabaseAdmin
            .from('members')
            .update({ auth_user_id: invitedUser.id, email, name: fullName, user_role: role })
            .eq('id', memberId)
          if (error) throw error
        } else {
          const { data: existingMember, error: existingError } = await supabaseAdmin
            .from('members')
            .select('id')
            .or(`auth_user_id.eq.${invitedUser.id},email.eq.${email}`)
            .maybeSingle()
          if (existingError) throw existingError

          if (existingMember) {
            const { error } = await supabaseAdmin
              .from('members')
              .update({ auth_user_id: invitedUser.id, email, name: fullName, user_role: role })
              .eq('id', existingMember.id)
            if (error) throw error
          } else {
            const { error } = await supabaseAdmin
              .from('members')
              .insert({ auth_user_id: invitedUser.id, email, name: fullName, user_role: role })
            if (error) throw error
          }
        }

        await upsertAccountStatus(invitedUser.id, 'active')
        await sendEmail(email, 'Pozvánka do EKV Portal', brandedEmail({
          title: 'Pozvánka do EKV Portal',
          intro: `${actorEmail} vám vytvořil účet v EKV Portal. Nastavte si heslo přes bezpečný odkaz níže.`,
          ctaLabel: 'Nastavit heslo',
          ctaUrl: linkData.properties.action_link,
          note: 'Odkaz je bezpečný a může po čase expirovat. Pokud nefunguje, požádejte administrátora o nové odeslání pozvánky.',
        }))
        await logAdminAction('invite_user', invitedUser.id, email, null, { role, member_id: memberId })

        return jsonResponse({ user: invitedUser })
      }

      case 'resend_invite': {
        const email = normalizeEmail(payload.email)
        if (!email) return jsonResponse({ error: 'Chybí e-mail.' }, 400)
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: { redirectTo: `${siteUrl}/update-password` },
        })
        if (linkError) throw linkError
        await sendEmail(email, 'Nová pozvánka do EKV Portal', brandedEmail({
          title: 'Nová pozvánka do EKV Portal',
          intro: 'Posíláme nový bezpečný odkaz pro nastavení hesla a dokončení přístupu do portálu.',
          ctaLabel: 'Dokončit pozvánku',
          ctaUrl: linkData.properties.action_link,
        }))
        await logAdminAction('resend_invite', payload.userId || linkData.user?.id || null, email, null, { resent: true })
        return jsonResponse({ sent: true })
      }

      case 'reset_password': {
        const email = normalizeEmail(payload.email)
        if (!email) return jsonResponse({ error: 'Chybí e-mail.' }, 400)
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${siteUrl}/update-password` },
        })
        if (linkError) throw linkError
        const emailData = await sendEmail(email, 'Obnova hesla do EKV Portal', brandedEmail({
          title: 'Obnova hesla',
          intro: 'Administrátor vám odeslal odkaz pro bezpečné nastavení nového hesla.',
          ctaLabel: 'Změnit heslo',
          ctaUrl: buildUpdatePasswordUrl(siteUrl, linkData as Record<string, any>),
          note: 'Pokud jste o obnovu hesla nežádali, tento e-mail ignorujte nebo kontaktujte administrátora.',
        }))
        await logAdminAction('reset_password', payload.userId || linkData.user?.id || null, email, null, { reset_link_sent: true })
        return jsonResponse({ emailData })
      }

      case 'update_user_name': {
        const { userId, full_name } = payload
        const before = await supabaseAdmin.auth.admin.getUserById(userId)
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { full_name } })
        if (error) throw error
        await supabaseAdmin.from('members').update({ name: full_name }).eq('auth_user_id', userId)
        await logAdminAction('update_user_name', userId, data.user?.email || null, before.data?.user?.user_metadata, { full_name })
        return jsonResponse(data)
      }

      case 'update_user_role': {
        const { userId, role } = payload
        if (!role) return jsonResponse({ error: 'Role cannot be empty' }, 400)
        const { data: before } = await supabaseAdmin.from('members').select('id, user_role, email').eq('auth_user_id', userId).maybeSingle()
        const { data, error } = await supabaseAdmin
          .from('members')
          .update({ user_role: role })
          .eq('auth_user_id', userId)
          .select('id, user_role, email')
          .maybeSingle()
        if (error) throw error
        if (!data) return jsonResponse({ error: 'Uživatel není propojený se zaměstnancem.' }, 409)
        await logAdminAction('update_user_role', userId, data.email || null, before, data)
        return jsonResponse(data)
      }

      case 'create_member_from_user': {
        const { userId, email, full_name, role = 'user' } = payload
        const { data: existingMember, error: selectError } = await supabaseAdmin
          .from('members')
          .select('id')
          .eq('auth_user_id', userId)
          .maybeSingle()
        if (selectError) throw selectError
        if (existingMember) return jsonResponse({ error: 'Tento uživatel už je propojený se zaměstnancem.' }, 409)

        const { data: newMember, error } = await supabaseAdmin
          .from('members')
          .insert({ auth_user_id: userId, email, name: full_name, user_role: role })
          .select()
          .single()
        if (error) throw error
        await logAdminAction('create_member_from_user', userId, email, null, newMember)
        return jsonResponse(newMember)
      }

      case 'deactivate_user': {
        const { userId, reason } = payload
        if (userId === authUser.id) return jsonResponse({ error: 'Vlastní účet nelze deaktivovat.' }, 400)
        const before = await supabaseAdmin.from('user_account_status').select('*').eq('auth_user_id', userId).maybeSingle()
        const data = await upsertAccountStatus(userId, 'disabled', reason)
        await logAdminAction('deactivate_user', userId, payload.email || null, before.data || null, data)
        return jsonResponse(data)
      }

      case 'reactivate_user': {
        const { userId } = payload
        const before = await supabaseAdmin.from('user_account_status').select('*').eq('auth_user_id', userId).maybeSingle()
        const data = await upsertAccountStatus(userId, 'active')
        await logAdminAction('reactivate_user', userId, payload.email || null, before.data || null, data)
        return jsonResponse(data)
      }

      case 'delete_user_nopass': {
        const { userId } = payload
        if (userId === authUser.id) return jsonResponse({ error: 'Vlastní účet nelze smazat.' }, 400)
        const before = await supabaseAdmin.auth.admin.getUserById(userId)
        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (error) throw error
        await logAdminAction('delete_user_nopass', userId, before.data?.user?.email || null, before.data?.user || null, { deleted: true })
        return jsonResponse({ message: 'Uživatel byl smazán.' })
      }

      default:
        return jsonResponse({ error: 'Invalid action' }, 400)
    }
  } catch (error) {
    console.error(error)
    return jsonResponse({ error: error.message }, 500)
  }
})
