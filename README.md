# XCodexUsage

Plugin para o Codex CLI que lê os eventos `token_count` dos transcripts locais e mostra um resumo das sessões, incluindo o percentual oficial da cota da conta e o horário de redefinição.

O Codex não tem a API de `statusLine` do Claude Code. Por isso o equivalente é um plugin de hooks: ele atualiza snapshots após cada ferramenta e ao fim de cada interação, e o relatório é exibido sob demanda.

```text
Codex │ ██░░░░░░░░ 16% · reinicia:6d02h │ sessões:3 │ entrada:4.31M │ cache:3.96M │ saída:33.3k │ raciocínio:7.7k
```

## Instalação local

No diretório deste repositório:

```bash
codex plugin marketplace add .
codex plugin add xcodex-usage@xcodex-usage
```

Reinicie o Codex após a instalação. Na primeira interação, os hooks criam `~/.codex/data/xcodex-usage/snapshots.json`.

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

## Instalação por agente de IA

Agentes podem seguir o procedimento autocontido em [INSTALL_GUIDE_AI.md](INSTALL_GUIDE_AI.md). Basta enviar ao agente o link raw desse arquivo com um pedido de instalar, atualizar ou desinstalar.

## Créditos

XCodexUsage é uma migração independente de [XClaudeUsage](https://github.com/SrDarf/XClaudeUsage), criado por [SrDarf](https://github.com/SrDarf). A ideia original, a arquitetura de acompanhamento local e o licenciamento MIT permanecem atribuídos ao autor e ao repositório de origem.
