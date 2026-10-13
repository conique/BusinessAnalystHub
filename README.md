# BusinessAnalystHub

BusinessAnalystHub (BAHub) é um painel leve para centralizar demandas, projetos e melhorias de negócio em um único espaço. A aplicação permite registrar iniciativas, acompanhar status, organizar áreas e prazos, além de manter um histórico visual por projeto em uma timeline.

## Visão geral

O projeto foi pensado para times de análise de negócio, gestão de projetos e operação, com foco em:

- organização de demandas por projeto, área e prazo;
- acompanhamento de status com rótulos visuais;
- criação de páginas de projeto com histórico de atualizações;
- suporte a anexos de mídia em cards;
- persistência local com sincronização na nuvem via Supabase.

## Funcionalidades

- Dashboard inicial com listagem de projetos;
- Ordenação por nome, rótulo, área e prazo;
- Cadastro de novas páginas/projetos;
- Timeline por projeto para registrar atualizações, tarefas, reuniões e decisões;
- Upload de imagens e vídeos em cards;
- Login e cadastro de usuários com autenticação do Supabase;
- Cache local em navegador para uso rápido e continuidade offline;
- Sincronização automatizada com banco na nuvem.

## Stack

- HTML5
- CSS3
- JavaScript vanilla
- Supabase JS
- localStorage / IndexedDB

## Estrutura do projeto

```text
BusinessAnalystHub-main/
├── css/
│   └── style.css
├── fonts/
├── js/
│   ├── config.js
│   ├── db.js
│   └── header.js
├── bg-header.png
├── cards.html
├── index.html
├── README.md
└── ...
```

## Como executar

Como é um projeto estático, não há build step nem dependências externas de instalação.

### Opção 1: abrir diretamente no navegador

1. Abra o arquivo `index.html` em um navegador.
2. O sistema carregará a interface principal.

### Opção 2: servidor local simples

No terminal, na pasta do projeto:

```bash
python -m http.server 8000
```

Depois acesse:

```text
http://localhost:8000
```

## Configuração do Supabase

A aplicação usa Supabase para autenticação e sincronização de dados. A configuração principal fica em `js/config.js`.

Você deve ajustar as variáveis do projeto Supabase para o seu ambiente:

```js
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANONIMA';
```

Além disso, o banco precisa ter a tabela/estrutura adequada para armazenar os dados do usuário e o payload do sistema.

## Fluxo de uso

1. Abra a aplicação.
2. Crie uma conta ou faça login.
3. Adicione projetos na página inicial.
4. Acesse o projeto para registrar cards na timeline.
5. Os dados são salvos localmente e sincronizados com o Supabase.

## Observações

- O projeto foi desenvolvido como uma solução de front-end leve e rápida.
- A parte de dados e autenticação depende do Supabase configurado corretamente.
- A interface está em português e foi pensada para uso interno de equipe.

## Licença

Este projeto não possui uma licença definida no repositório. Se for reutilizar o código em produção, verifique a política interna da organização antes de distribuir ou publicar.

