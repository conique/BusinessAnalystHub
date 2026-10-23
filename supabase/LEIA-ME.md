# Múltiplos workspaces — guia de migração

A tabela `public.bahub_dados` **não é alterada nem apagada** por nada neste projeto.
O app novo só a **lê**, e apenas para trazer para um workspace quem ainda não foi copiado
(constante `MIGRAR_LEGADO_SOB_DEMANDA` em `js/db.js`; desligue quando aposentar a tabela).

## Ordem de execução (SQL Editor do Supabase)

1. `01_verificar_politicas.sql` — somente leitura. Mostra RLS, políticas existentes, contagens (esperado 4/4/4), se a cópia está idêntica e permissões.
2. `02_politicas_workspaces.sql` — idempotente. Só cria a política de uma operação se nenhuma existente já a cobrir; não apaga nada. Rode o 01 de novo depois.
3. `03_rollback_e_ressincronizacao.sql` — tudo comentado. Use o **bloco A (backup)** antes de publicar.

> Atenção: se o app antigo continuou gravando em `bahub_dados` depois da cópia, o item
> "dados DIFERENTES da tabela legada" do 01 será maior que 0. Resolva com o bloco B do 03
> **antes** de publicar o app novo.

## Como o app se comporta agora

- Ao entrar no site (aba nova) aparece a **tela de boas-vindas**: entrar em um workspace existente ou criar outro. Recarregar a mesma aba mantém o workspace; o painel lateral (☰) lista os workspaces, cria novos e volta à tela de boas-vindas.
- Dados: `bahub_workspace_data.dados` continua `{ itens, preferencias }` (formato antigo em array ainda é aceito e convertido).
- Conflito de versão: `UPDATE ... WHERE workspace_id = ? AND atualizado_em = <versão lida>`; cada envio grava um `atualizado_em` novo (não depende de gatilho).
- Cache local: `bahub_db:<workspace_id>`, `bahub_preferencias:<workspace_id>`, `bahub_pendente:<workspace_id>`; histórico (desfazer) por workspace na sessão.
- Alterações pendentes no cache da versão antiga (chaves sem id) são enviadas ao workspace inicial na primeira abertura.
- Mídias continuam em `midias/<user_id>/<id>` (sem mudança de Storage; os ids são únicos).

## Validação ponta a ponta (antes de aposentar a bahub_dados)

- [ ] 01 sem "NENHUMA POLÍTICA", RLS ligado, contagens 4/4/4, cópia idêntica
- [ ] Entrar com uma conta antiga: aparece "Workspace inicial" com os dados de sempre
- [ ] Criar um workspace novo, adicionar itens, recarregar, abrir em outro navegador
- [ ] Trocar de workspace pelo painel e conferir que os dados não se misturam
- [ ] Duas abas editando o mesmo workspace: a segunda recebe o aviso de conflito
- [ ] Conta B não enxerga workspaces da conta A
- [ ] Mídias (imagens/arquivos dos cards) abrem normalmente

## Rollback

Volte o front-end ao commit anterior: o app antigo continua usando `bahub_dados`, intacta.
Trabalho feito só nos workspaces depois da publicação não está em `bahub_dados`; para levar o
workspace inicial de volta use o bloco D do 03 (faça o backup A antes).

## Fora do escopo (de propósito)

Renomear/excluir workspace, membros e compartilhamento entre contas. As opções de rótulos/área
(`bahub_opcoes_*`) seguem salvas só no navegador, como antes, e valem para todos os workspaces.
