---
name: acessibilidade
description: Audita acessibilidade de aplicações web e gera um relatório priorizado com evidências. Use /acessibilidade para avaliar; use /widget quando o pedido for integrar o widget assistivo.
metadata:
  short-description: Audita acessibilidade e gera relatório
---

# Auditoria de acessibilidade web

Use `/acessibilidade` para inspecionar o projeto atual e entregar um relatório rastreável de barreiras, correções necessárias e melhorias. A auditoria avalia os critérios WCAG 2.2 níveis A e AA aplicáveis e verifica referências brasileiras conforme o contexto conhecido do produto.

## Fluxo

1. Confirme o projeto-alvo, framework, rotas, conteúdo e recursos presentes. Leia [critérios e método](references/criteria-and-method.md) e use [modelo de relatório](references/report-template.md).
2. Levante páginas e estados relevantes. Se a skill `/widget` estiver instalada, resolva seu diretório e rode `node <caminho-da-skill-widget>/assets/graph-scanner/bin/graph-scanner.js scan <projeto-alvo> --dry-run` para obter rotas, controles e diálogos conhecidos. Não use `widget/scripts/scan-project.mjs`, pois esse wrapper também escreve o mapa público do widget. Se houver uma sessão autenticada e a extensão local estiver disponível, a captura pode executar axe-core em cada rota capturada. Não faça login, não contorne autenticação e não acione ações de efeito colateral. Se a extensão ou uma permissão necessária não estiver disponível, prossiga com o restante e informe a cobertura limitada.
3. Examine o código e os resultados automatizados. Combine ferramentas com revisão manual viável: automação encontra apenas parte das barreiras. Diferencie evidência estática, resultado de axe e verificação manual; registre o método e o limite de cada achado.
   - Se o sistema já incluir o widget Skip, revise o fluxo de navegação por objetivo, o foco e a instrução azul no modo guiado, a ativação verificada no modo automático e a atualização das ações quando rota ou diálogo mudar. Relate somente barreiras observadas e associe-as aos critérios WCAG que realmente se aplicam; a presença da navegação por objetivo, isoladamente, é uma função opcional.
4. Classifique cada achado com um dos rótulos exatos definidos no anexo. Verifique a aplicabilidade e as exceções no critério normativo antes de classificar. Não promova uma recomendação a obrigação e não marque N/A sem evidência de que a situação não existe.
5. Priorize primeiro os itens obrigatórios críticos, depois os demais obrigatórios, itens obrigatórios quando aplicáveis, recomendados e, por último, opcionais. Mantenha a urgência (impacto crítico/alto/normal) separada da classificação normativa. Descreva correção e validação verificável para cada problema.
6. Grave o relatório em `docs/accessibility/audit-YYYY-MM-DD.md` (usar a data atual). Preserve relatórios anteriores; se já existir um arquivo para o dia, acrescente hora ao nome. Entregue também no chat um resumo, a cobertura e limitações.

## Limites da auditoria

- Esta skill audita e relata. Não altere o código do produto, não instale dependências e não adicione um overlay/widget como substituto de correções estruturais. Faça correções somente se o usuário pedir explicitamente.
- Não declare “conforme WCAG 2.2 AA” com base em axe, análise estática, poucas páginas ou verificações incompletas. Informe critérios e estados não cobertos; use `Requer revisão manual` quando a evidência não permite conclusão.
- Não declare conformidade legal, ausência de risco ou garantia contra processo. Se a obrigação depender de setor, natureza da organização, contrato, serviço público, relação de consumo ou interpretação normativa, marque `⚠ REVISÃO JURÍDICA NECESSÁRIA` e explique o ponto pendente.
- Não capture nem inclua segredos, cookies, dados pessoais ou valores digitados em formulários. A extensão pode registrar texto visível da página; prefira ambiente de teste com dados fictícios e não capture páginas com dados sensíveis. Registre seletor, rota, componente e evidência mínima necessária.
- Não confunda `/acessibilidade` com `/widget`: este comando produz auditoria e backlog; `/widget` integra o widget assistivo.
