-- =====================================================================
-- 02 — POLÍTICAS RLS DOS WORKSPACES (idempotente)
-- Rode DEPOIS de ler o resultado do 01.
--
-- * NÃO toca em public.bahub_dados.
-- * Para cada operação (select/insert/update/delete) só cria a política se NÃO
--   existir nenhuma política que já cubra aquela operação na tabela (inclusive
--   políticas "ALL" criadas por você). Quando pula, avisa em "Messages".
--   Se o 01 mostrou políticas diferentes das planejadas (ex.: USING true),
--   corrija-as à mão: este script não apaga nada.
-- * Regra: acesso somente quando bahub_workspaces.owner_id = auth.uid();
--   em bahub_workspace_data, somente quando o workspace pertence ao usuário.
-- * Não há membros/compartilhamento entre contas.
-- =====================================================================
begin;

alter table public.bahub_workspaces      enable row level security;
alter table public.bahub_workspace_data  enable row level security;

grant select, insert, update, delete on public.bahub_workspaces     to authenticated;
grant select, insert, update, delete on public.bahub_workspace_data to authenticated;

-- as consultas do app filtram por owner_id; o RLS também usa essa coluna
create index if not exists bahub_workspaces_owner_id_idx on public.bahub_workspaces (owner_id);

create or replace function pg_temp.criar_politica(p_tabela text, p_cmd text, p_ddl text)
returns void language plpgsql as $f$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = p_tabela
                and (cmd = 'ALL' or cmd = upper(p_cmd))) then
    raise notice '% (%): já existe política que cobre esta operação — nada foi criado.', p_tabela, p_cmd;
  else
    execute p_ddl;
    raise notice '% (%): política criada.', p_tabela, p_cmd;
  end if;
end
$f$;

-- ---------- bahub_workspaces: o dono é quem tem owner_id = auth.uid() ----------
select pg_temp.criar_politica('bahub_workspaces', 'select', $q$
  create policy bahub_workspaces_dono_select on public.bahub_workspaces
    for select to authenticated
    using (owner_id = (select auth.uid()))
$q$);
select pg_temp.criar_politica('bahub_workspaces', 'insert', $q$
  create policy bahub_workspaces_dono_insert on public.bahub_workspaces
    for insert to authenticated
    with check (owner_id = (select auth.uid()))
$q$);
select pg_temp.criar_politica('bahub_workspaces', 'update', $q$
  create policy bahub_workspaces_dono_update on public.bahub_workspaces
    for update to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()))
$q$);
select pg_temp.criar_politica('bahub_workspaces', 'delete', $q$
  create policy bahub_workspaces_dono_delete on public.bahub_workspaces
    for delete to authenticated
    using (owner_id = (select auth.uid()))
$q$);

-- ---------- bahub_workspace_data: só se o workspace pertence ao usuário ----------
select pg_temp.criar_politica('bahub_workspace_data', 'select', $q$
  create policy bahub_workspace_data_dono_select on public.bahub_workspace_data
    for select to authenticated
    using (exists (select 1 from public.bahub_workspaces w
                    where w.id = bahub_workspace_data.workspace_id
                      and w.owner_id = (select auth.uid())))
$q$);
select pg_temp.criar_politica('bahub_workspace_data', 'insert', $q$
  create policy bahub_workspace_data_dono_insert on public.bahub_workspace_data
    for insert to authenticated
    with check (exists (select 1 from public.bahub_workspaces w
                         where w.id = bahub_workspace_data.workspace_id
                           and w.owner_id = (select auth.uid())))
$q$);
select pg_temp.criar_politica('bahub_workspace_data', 'update', $q$
  create policy bahub_workspace_data_dono_update on public.bahub_workspace_data
    for update to authenticated
    using (exists (select 1 from public.bahub_workspaces w
                    where w.id = bahub_workspace_data.workspace_id
                      and w.owner_id = (select auth.uid())))
    with check (exists (select 1 from public.bahub_workspaces w
                         where w.id = bahub_workspace_data.workspace_id
                           and w.owner_id = (select auth.uid())))
$q$);
select pg_temp.criar_politica('bahub_workspace_data', 'delete', $q$
  create policy bahub_workspace_data_dono_delete on public.bahub_workspace_data
    for delete to authenticated
    using (exists (select 1 from public.bahub_workspaces w
                    where w.id = bahub_workspace_data.workspace_id
                      and w.owner_id = (select auth.uid())))
$q$);

commit;

-- Depois de rodar, execute o 01 de novo: as 8 políticas (ou equivalentes) devem aparecer.
