
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0'
import { corsHeaders } from './cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    
    const { action, payload } = await req.json()

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error("Missing Authorization header")
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: authUser }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError) {
      return new Response(JSON.stringify({ error: `Authentication error: ${userError.message}` }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const authenticatedSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: adminRoleData, error: roleError } = await authenticatedSupabase.rpc('get_user_role');
    if (roleError) {
        console.error("Role check error:", roleError);
        return new Response(JSON.stringify({ error: "Could not verify user role." }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const isAdmin = adminRoleData === 'admin';

    if (action === 'list_users') {
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        
        const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        if (listError) throw listError;
        
        const { data: members, error: membersError } = await supabaseAdmin.from('members').select('auth_user_id, user_role');
        if (membersError) throw membersError;

        const memberMap = new Map(members.map(m => [m.auth_user_id, { is_member: true, member_role: m.user_role }]));

        const { data: userRoles, error: userRolesError } = await supabaseAdmin.from('user_roles').select('role_name');
        if (userRolesError) throw userRolesError;

        const usersWithDetails = users.map(u => {
            const memberDetails = memberMap.get(u.id);
            const rlsRole = memberDetails?.member_role;
            
            return {
                ...u,
                user_metadata: {
                    ...u.user_metadata,
                    role: rlsRole,
                },
                is_member: !!memberDetails,
            };
        });

        return new Response(JSON.stringify({ users: usersWithDetails, roles: userRoles.map(r => r.role_name) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Access denied: Admin role required for this action." }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    
    switch (action) {
      case 'invite_user': {
        const { email, full_name } = payload;
        
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
            email,
            { 
              data: { full_name },
              redirectTo: `${Deno.env.get('VITE_SITE_URL')}/update-password`
            }
        );

        if (error) {
            // Check if user already exists
            if (error.message.includes('already exists')) {
                return new Response(JSON.stringify({ error: 'Uzivatel s timto e-mailem jiz existuje.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            throw error;
        }

        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      case 'delete_user_nopass': {
        const { userId } = payload;
        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (error) throw error;
        return new Response(JSON.stringify({ message: 'User deleted successfully' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      case 'update_user_name': {
        const { userId, full_name } = payload
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { full_name } })
        if (error) throw error
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'update_user_role': {
        const { userId, role } = payload;

        if (!role) {
            return new Response(JSON.stringify({ error: "Role cannot be empty" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const { data, error } = await supabaseAdmin
            .from('members')
            .update({ user_role: role })
            .eq('auth_user_id', userId)
            .select()
            .maybeSingle();

        if (error) throw error;
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      case 'reset_password': {
          const { email } = payload
          const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
              type: 'recovery',
              email: email,
              options: {
                redirectTo: `${Deno.env.get('VITE_SITE_URL')}/update-password`
              }
          });
          if (linkError) throw linkError;

          const { data: emailData, error: emailError } = await authenticatedSupabase.functions.invoke('send-email', {
            body: JSON.stringify({
              to: email,
              subject: 'Zadost o obnovu hesla',
              htmlContent: `
                <h1>Obnova hesla</h1>
                <p>Pro obnoveni hesla kliknete na odkaz nize:</p>
                <a href="${linkData.properties.action_link}">Obnovit heslo</a>
                <p>Pokud jste o obnovu hesla nezadali, tento e-mail ignorujte.</p>
              `,
            })
          });

          if (emailError) throw emailError;

          return new Response(JSON.stringify({ emailData }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'create_member_from_user': {
        const { userId, email, full_name } = payload;
        
        const { data: existingMember, error: selectError } = await supabaseAdmin
            .from('members')
            .select('id')
            .eq('auth_user_id', userId)
            .maybeSingle();

        if (selectError) {
            throw selectError;
        }

        if (existingMember) {
             return new Response(JSON.stringify({ error: "Tento uzivatel je jiz projektantem." }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        
        const { data: newMember, error } = await supabaseAdmin
            .from('members')
            .insert({ auth_user_id: userId, email, name: full_name, user_role: 'user' })
            .select()
            .single();

        if (error) throw error;
        return new Response(JSON.stringify(newMember), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
