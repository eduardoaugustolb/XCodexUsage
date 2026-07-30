# XCodexUsage

Plugin para o Codex CLI que lê os eventos `token_count` dos transcripts locais e mostra um resumo das sessões, incluindo o percentual oficial da cota da conta e o horário de redefinição.

O Codex não tem a API de `statusLine` do Claude Code. Por isso o equivalente é um plugin de hooks: ele atualiza snapshots após cada ferramenta e ao fim de cada interação, e o relatório é exibido sob demanda.

```text
Codex │ ██░░░░░░░░ 16% · reinicia:6d02h │ sessões:3 │ entrada:4.31M │ cache:3.96M │ saída:33.3k │ raciocínio:7.7k
```

## Instalação manual

Pré-requisito: [Codex CLI](https://developers.openai.com/codex) instalado e disponível como `codex` no terminal.

Instale o plugin público diretamente do GitHub:

```bash
codex plugin marketplace add eduardoaugustolb/XCodexUsage --ref main
codex plugin add xcodex-usage@xcodex-usage
PLUGIN_ROOT="$(codex plugin list --marketplace xcodex-usage --json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const plugin = JSON.parse(data).installed.find(p => p.pluginId === "xcodex-usage@xcodex-usage"); if (!plugin) process.exit(1); process.stdout.write(plugin.source.path); });')"
node "$PLUGIN_ROOT/scripts/configure-statusline.js"
```

Feche e abra o Codex após instalar. O rodapé nativo passa a mostrar modelo, contexto, tokens usados, branch e diretório. Quando a conta expuser limites compatíveis, os itens de 5h e semanal também aparecem.

O comando de configuração modifica apenas `tui.status_line` em `~/.codex/config.toml`. Você também pode escolher/reordenar os itens interativamente com `/statusline` dentro do Codex. Ao iniciar, o plugin mostra na TUI o último estado salvo; ao fim de cada turno, atualiza a linha com a cota efetiva da conta, o tempo até o reset e o percentual do contexto da sessão — inclusive para planos cuja janela não seja exibida pelo rodapé nativo.

Para atualizar:

```bash
codex plugin marketplace upgrade xcodex-usage
codex plugin add xcodex-usage@xcodex-usage
PLUGIN_ROOT="$(codex plugin list --marketplace xcodex-usage --json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const plugin = JSON.parse(data).installed.find(p => p.pluginId === "xcodex-usage@xcodex-usage"); if (!plugin) process.exit(1); process.stdout.write(plugin.source.path); });')"
node "$PLUGIN_ROOT/scripts/configure-statusline.js"
```

Para desinstalar sem remover o marketplace:

```bash
codex plugin remove xcodex-usage@xcodex-usage
```

Em desenvolvimento, a fonte local também pode ser usada:

```bash
codex plugin marketplace add .
codex plugin add xcodex-usage@xcodex-usage
node plugins/xcodex-usage/scripts/configure-statusline.js
```

Para consultar o resumo:

```bash
node ~/.codex/plugins/cache/*/xcodex-usage/*/scripts/usage.js
```

Durante desenvolvimento, prefira executar o arquivo do checkout:

```bash
node plugins/xcodex-usage/scripts/usage.js
```

## Como funciona

- `PostToolUse` e `Stop` executam `scripts/record.js`.
- O recorder lê o último evento `event_msg/token_count` do transcript recebido pelo hook e guarda um snapshot local por sessão.
- `scripts/usage.js` agrega os snapshots e usa `rate_limits.primary` do Codex para mostrar a cota da conta e o próximo reset.

Os valores de tokens são totais acumulados pelos transcripts salvos, não uma estimativa da cota. O percentual da cota vem diretamente do Codex.

## Limitações

- Não há extensão pública para substituir a barra de status do TUI do Codex; a saída é intencionalmente um comando separado.
- Snapshots são atualizados somente enquanto o plugin está ativo. Excluir `~/.codex/data/xcodex-usage/snapshots.json` reinicia o histórico local.

## Desenvolvimento

Valide o manifesto antes de instalar:

```bash
python3 /home/eduardoaugusto/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/xcodex-usage
```

## Uso por agente de IA

Envie ao agente um dos prompts abaixo com o link raw do [guia operacional](AI_AGENT_GUIDE.md):

```text
Instala isso no meu Codex: https://raw.githubusercontent.com/eduardoaugustolb/XCodexUsage/refs/heads/main/AI_AGENT_GUIDE.md
Atualiza isso: https://raw.githubusercontent.com/eduardoaugustolb/XCodexUsage/refs/heads/main/AI_AGENT_GUIDE.md
Desinstala isso: https://raw.githubusercontent.com/eduardoaugustolb/XCodexUsage/refs/heads/main/AI_AGENT_GUIDE.md
```

O guia instrui o agente a validar a origem, usar os comandos oficiais do Codex, configurar o rodapé nativo, respeitar permissões para alterar `~/.codex` e não executar código trazido pelo arquivo raw.

## Créditos

XCodexUsage é uma migração independente de [XClaudeUsage](https://github.com/SrDarf/XClaudeUsage), criado por [SrDarf](https://github.com/SrDarf). A ideia original, a arquitetura de acompanhamento local e o licenciamento MIT permanecem atribuídos ao autor e ao repositório de origem.
