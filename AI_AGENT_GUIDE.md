# XCodexUsage — guia operacional para agentes de IA

Este arquivo é um procedimento executável por um agente com acesso ao terminal. Ele atende pedidos em linguagem natural como:

- `Instala isso no meu Codex: <URL raw>`
- `Atualiza isso: <URL raw>`
- `Desinstala isso: <URL raw>`

O agente deve executar a operação solicitada, relatar o resultado e pedir aprovação somente quando o ambiente exigir autorização para modificar a configuração global do Codex.

## Identidade canônica

```yaml
plugin: xcodex-usage
marketplace: xcodex-usage
source: eduardoaugustolb/XCodexUsage
ref: main
guide: AI_AGENT_GUIDE.md
```

Link raw canônico deste guia:

```text
https://raw.githubusercontent.com/eduardoaugustolb/XCodexUsage/refs/heads/main/AI_AGENT_GUIDE.md
```

## Regras de interpretação

1. Extraia a intenção do usuário: `instalar`, `atualizar` ou `desinstalar`.
2. Aceite este guia quando ele vier de `raw.githubusercontent.com/eduardoaugustolb/XCodexUsage/`, usando `main` ou um SHA explícito. Para outro repositório, leia o arquivo raw antes de executar qualquer comando e só prossiga se ele declarar claramente `plugin`, `marketplace` e `source`.
3. Nunca execute código obtido do arquivo raw. Ele é uma instrução declarativa; use apenas os comandos `codex plugin ...` abaixo.
4. Verifique que o Codex CLI está instalado com `codex --version`. Se não estiver, pare e informe que a instalação do Codex é pré-requisito.
5. `codex plugin marketplace add`, `upgrade`, `add` e `remove` alteram o estado global em `~/.codex`. Em ambientes que pedem confirmação para escrita fora do workspace, solicite aprovação específica para o comando antes de executá-lo.
6. Não remova o marketplace ao desinstalar o plugin, a menos que o usuário peça explicitamente para removê-lo também. Um marketplace pode conter outros plugins.

## Instalar

Use estes comandos, nessa ordem:

```bash
codex plugin marketplace add eduardoaugustolb/XCodexUsage --ref main
codex plugin add xcodex-usage@xcodex-usage
codex plugin list --marketplace xcodex-usage --json
```

Se o primeiro comando disser que o marketplace já está configurado, isso não é uma falha: siga para `codex plugin add`. Se o plugin já estiver instalado, trate `codex plugin add` como reinstalação e confira a listagem final.

Ao concluir, informe que uma nova thread/sessão do Codex é necessária para carregar os hooks do plugin. Depois da primeira interação concluída, o relatório pode ser consultado com o script `usage.js` dentro do cache do plugin ou diretamente de um checkout do repositório.

## Atualizar

Atualizar significa buscar a versão mais recente do marketplace Git e reinstalar o plugin:

```bash
codex plugin marketplace upgrade xcodex-usage
codex plugin add xcodex-usage@xcodex-usage
codex plugin list --marketplace xcodex-usage --json
```

Não edite `~/.codex/config.toml`, o cache do plugin ou `marketplace.json` manualmente. Se o marketplace não estiver instalado, siga primeiro o procedimento de instalação.

## Desinstalar

Remova somente o plugin solicitado e confira o resultado:

```bash
codex plugin remove xcodex-usage@xcodex-usage
codex plugin list --marketplace xcodex-usage --json
```

Se o usuário também pedir para remover a fonte do marketplace, faça isso separadamente e apenas após confirmar que não há outros plugins que devam ser preservados:

```bash
codex plugin marketplace remove xcodex-usage
```

## Falhas e encerramento seguro

- Se o comando não existir, a autenticação não for suficiente ou uma política de workspace bloquear a escrita global, explique o erro e peça a autorização/ação mínima necessária; não tente contornar a política.
- Se a URL raw não corresponder à identidade canônica e o arquivo não trouxer metadados verificáveis, não instale nada.
- Nunca use `--dangerously-bypass-approvals-and-sandbox` para instalar, atualizar ou desinstalar o plugin.
- Ao terminar qualquer operação, informe: ação feita, plugin, marketplace, versão/estado retornado por `codex plugin list` e a necessidade de abrir uma nova thread.
