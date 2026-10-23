-- =====================================================================
-- 01 — DIAGNÓSTICO (SOMENTE LEITURA — não altera nada)
-- Rode ANTES do 02. Mostra, numa única tabela:
--   1. se o RLS está ligado nas tabelas
--   2. quais políticas já existem (e se alguma tabela está sem política)
--   3. contagem de registros (esperado: 4 / 4 / 4)
--   4. se a cópia da bahub_dados para os workspaces está completa e idêntica
--   5. quem tem permissão de tabela (anon não deveria ter nas tabelas novas)
-- =====================================================================
select * from (

  select '1. RLS' as secao, c.relname::text as item,
         case when c.relrowsecurity then 'RLS ligado' else 'RLS DESLIGADO' end as resultado,
         'forçado para o dono da tabela: ' || c.relforcerowsecurity::text as detalhe
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('bahub_dados', 'bahub_workspaces', 'bahub_workspace_data')

  union all
  select '2. Políticas', tablename || ' / ' || policyname,
         cmd || ' para ' || roles::text,
         'USING: ' || coalesce(qual, '-') || '  |  WITH CHECK: ' || coalesce(with_check, '-')
    from pg_policies
   where schemaname = 'public'
     and tablename in ('bahub_dados', 'bahub_workspaces', 'bahub_workspace_data')

  union all
  select '2. Políticas', v.t, 'NENHUMA POLÍTICA',
         'com RLS ligado e sem política, ninguém consegue ler nem gravar (o app mostraria a lista vazia)'
    from (values ('bahub_workspaces'), ('bahub_workspace_data')) as v(t)
   where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v.t)

  union all select '3. Contagens', 'bahub_dados (legado)',  count(*)::text, 'esperado: 4' from public.bahub_dados
  union all select '3. Contagens', 'bahub_workspaces',      count(*)::text, 'esperado: 4' from public.bahub_workspaces
  union all select '3. Contagens', 'bahub_workspace_data',  count(*)::text, 'esperado: 4' from public.bahub_workspace_data

  union all
  select '4. Cópia', 'registros legados SEM workspace', count(*)::text, 'esperado: 0'
    from public.bahub_dados d
   where not exists (select 1 from public.bahub_workspaces w where w.legacy_user_id = d.user_id)

  union all
  select '4. Cópia', 'workspaces legados SEM linha de dados', count(*)::text, 'esperado: 0'
    from public.bahub_workspaces w
   where w.legacy_user_id is not null
     and not exists (select 1 from public.bahub_workspace_data wd where wd.workspace_id = w.id)

  union all
  select '4. Cópia', 'dados DIFERENTES da tabela legada', count(*)::text,
         'esperado: 0. Se > 0, o app antigo gravou depois da cópia: veja 03_rollback_e_ressincronizacao.sql'
    from public.bahub_dados d
    join public.bahub_workspaces w on w.legacy_user_id = d.user_id
    join public.bahub_workspace_data wd on wd.workspace_id = w.id
   where wd.dados::jsonb is distinct from d.dados::jsonb

  union all
  select '4. Cópia', 'workspaces cujo dono NÃO é o user_id legado', count(*)::text, 'esperado: 0'
    from public.bahub_workspaces w where w.legacy_user_id is not null and w.owner_id <> w.legacy_user_id

  union all
  select '5. Permissões', grantee || ' em ' || table_name, string_agg(privilege_type, ', ' order by privilege_type),
         case when grantee = 'anon' then 'atenção: anon não deveria ter acesso às tabelas de workspace' else '' end
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('bahub_workspaces', 'bahub_workspace_data')
     and grantee in ('anon', 'authenticated')
   group by grantee, table_name

) diagnostico
order by secao, item;
