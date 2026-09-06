# CRM 2.0 — Raynet, FVE a obchodní aktivity

## Cíl

Převést ověřený FVE obchodní postup z Raynetu do EKV Portálu a sjednotit příležitost, komunikaci, schůzky, nabídky, objednávky a obchodní cíle do jednoho pracovního toku.

## Implementace

- [x] Navrhnout společný datový model aktivit (telefonát, schůzka, e-mail, úkol, poznámka).
- [x] Přidat čas, místo, účastníky, výsledek, zápis a další krok.
- [x] Přidat audit změn aktivit.
- [x] Přidat měsíční cíle obchodníků a serverový přehled plnění.
- [x] Přidat konfigurovatelnou šablonu FVE obchodního případu.
- [x] Přidat vytváření a editaci aktivit do detailu obchodního případu.
- [x] Přidat týmový přehled aktivit a cílů.
- [x] Přidat odeslání pozvánky a synchronizaci události přes Microsoft Graph.
- [ ] Po zpřístupnění Raynetu provést inventuru typů OP, vlastních polí, stavů a aktivit.
- [ ] Doplnit přesné Raynet → EKV mapování a jednorázový import.
- [ ] Ověřit migrace, RLS, build, UI a připravit bezpečný rollout.

## Raynet mapování

Raynet zůstane zdrojem pro počáteční převod. Do EKV se budou mapovat zejména:

| Raynet | EKV Portal |
| --- | --- |
| Obchodní případ | `crm_opportunities` |
| Kategorie / typ FVE | `business_type`, `category`, šablona OP |
| Vlastní pole FVE | `custom_fields` |
| Aktivita | `crm_activities` |
| Událost / schůzka | CRM aktivita typu `meeting` + kalendář |
| Poznámka ze schůzky | `meeting_minutes`, `outcome`, `next_step` |
| Nabídka / objednávka | `crm_commercial_documents` a jejich verze |
| Vlastník OP | `owner_member_id` |

Přístupové údaje ani exporty se neukládají do repozitáře. Přesné mapování se uzavře až nad skutečnou konfigurací Raynetu.
