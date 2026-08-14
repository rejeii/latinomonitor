---
description: Obriga o agente a realizar commit e push após finalizar alterações locais.
always_on: true
---
# Workflow Obrigatório de Git

Sempre que você finalizar a codificação de uma funcionalidade, corrigir um bug, ou realizar qualquer alteração significativa em arquivos locais do projeto, você DEVE, obrigatoriamente, sincronizar essas mudanças com o repositório remoto antes de dar a tarefa como concluída.

Passos obrigatórios:
1. Faça o stage dos arquivos (`git add`).
2. Faça o commit com uma mensagem descritiva (`git commit -m "..."`).
3. Faça o push para o GitHub (`git push`).

**EXCEÇÃO / ALERTA:** Se por algum motivo técnico (falta de permissão, erro de rede, ou conflitos de merge) você tentar fazer o push e falhar, ou se você decidir pular essa etapa por algum motivo muito específico, você DEVE incluir um aviso explícito e chamativo na sua resposta ao usuário informando que as alterações ficaram APENAS locais.
