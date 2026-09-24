# Critérios e método de auditoria

## Classificação obrigatória

Use exatamente um rótulo por requisito ou achado:

- 🔴 [OBRIGATÓRIO]
- 🟠 [OBRIGATÓRIO QUANDO APLICÁVEL]
- 🟡 [RECOMENDADO]
- ⚪ [OPCIONAL]

### 🔴 [OBRIGATÓRIO]

Use para requisito necessário à meta WCAG 2.2 nível AA quando o critério A/AA se aplica ao conteúdo ou interação avaliada, ou quando outro requisito obrigatório efetivamente aplicável foi confirmado. Inclui todos os critérios de sucesso A e AA aplicáveis, não só itens que axe detecta. Não aceite preferência visual, prazo, dificuldade ou escolha de framework como exceção.

### 🟠 [OBRIGATÓRIO QUANDO APLICÁVEL]

Use para requisito normativo condicionado a uma funcionalidade, conteúdo ou situação existente. Verifique e documente a condição. Exemplos: vídeos e áudio; formulários e validação; diálogos; autenticação; limites de tempo; CAPTCHA; gráficos e tabelas; conteúdo atualizado dinamicamente; movimento ou conteúdo piscando; drag-and-drop; tarefas financeiras, jurídicas ou que alteram dados; componentes customizados. Se o recurso não existe e o escopo foi verificado, registre N/A com evidência. Não implemente recurso inexistente só para satisfazer uma condição.

### 🟡 [RECOMENDADO]

Use para melhorias que aumentam acessibilidade ou robustez, mas não são requisitos gerais WCAG 2.2 AA. Exemplos: critérios AAA; targets de cerca de 44×44 CSS px quando o critério AA aplicável já é cumprido; combinações adicionais de navegador/leitor de tela; recursos cognitivos adicionais; atalhos opcionais; documentação e formatos alternativos adicionais; auditoria periódica especializada. Implemente no relatório como sugestão quando houver benefício claro, sem declarar não conformidade AA apenas por sua ausência.

### ⚪ [OPCIONAL]

Use para conveniências que podem ajudar parte das pessoas, mas não substituem acessibilidade estrutural e não são requisito geral WCAG AA: controles próprios de fonte, contraste ou espaçamento; tema extra; menu ou toolbar flutuante; botão “modo acessível”; atalhos personalizados e outros recursos auxiliares. A ausência de uma opção não é, por si só, falha de conformidade.

Um widget, VLibras, overlay, leitor automático, menu de acessibilidade ou botão de contraste não corrige HTML/semântica, teclado, foco, contraste padrão, rótulos, ARIA, formulários ou compatibilidade com tecnologia assistiva. Corrija primeiro toda barreira obrigatória aplicável. Nunca recomende um item opcional em substituição.

## Escopo normativo

- Meta técnica desta auditoria: verificar todos os critérios de sucesso WCAG 2.2 níveis A e AA que se aplicam às páginas, estados e fluxos no escopo. Use a especificação normativa e o Quick Reference oficial; confira definições, exceções, limites e alternativas de conformidade do critério antes de registrar uma falha. WCAG é testável com combinação de avaliação automática e humana; axe não cobre todos os critérios.
- Considere requisitos aplicáveis a teclado, armadilhas, foco visível e não obscurecido, semântica e nome/função/estado, formulários e erros, contraste, uso de cor, conteúdo não textual, títulos/idioma/estrutura, links, ampliação/reflow/espaçamento, movimento e flashes, target size, alternativa para arrastar, autenticação, entrada redundante, mensagens de status, mídia e tecnologias assistivas.
- Não trate “44×44 px para todo botão” como obrigação AA. Verifique WCAG 2.2 SC 2.5.8 (Target Size (Minimum)), dimensões e espaçamento exigidos e todas as exceções aplicáveis.
- Para cada requisito, marque conforme, não conforme, N/A ou não avaliado/revisão manual e inclua a evidência. “Sem violações no axe” significa apenas que aquela execução do axe não encontrou violações detectáveis na página/estado capturado.

## Inspeção e evidência

1. Delimite páginas, estados, fluxos, viewport e ferramentas testadas. Use o grafo de telas como inventário, não como prova de conformidade. Inclua diálogos/overlays e estados dinâmicos conhecidos.
2. Analise o código e rode apenas verificações de acessibilidade já existentes no projeto. Se disponível, use a captura autenticada da extensão empacotada com `/widget`; ela executa axe-core 4.13 nas páginas/rotas capturadas. No scanner atual, diálogos são capturados, mas o resultado axe deles vem como `performed: false`; revise esses estados manualmente ou marque-os como não avaliados. Deixe campos sem valores e nunca submeta formulários.
3. A extensão pode gravar texto visível da página nos artefatos locais. Prefira um ambiente de teste com dados fictícios; se a página contém dados pessoais/sensíveis, não faça captura dinâmica. Não envie artefatos a backend externo.
4. Faça revisão manual quando possível: percorra controles por teclado, acompanhe ordem e visibilidade do foco, inspecione estados/dialogs, zoom/reflow, nomes/estados expostos e feedback dinâmico. Use leitores de tela somente se já disponíveis. Descreva como cada observação foi feita.
   - Se o produto integrar o widget Skip, confira também o fluxo de navegação: existe uma entrada clara para pedir uma tela por objetivo; o modo guiado leva ao controle, mantém foco e apresenta contorno azul com instrução visível sem ativar o controle; o modo automático percorre controles de navegação confirmados e verifica cada destino; e a lista de ações acompanha mudanças de rota e diálogos. Registre o comportamento observado e a evidência. Avalie defeitos contra critérios WCAG aplicáveis (por exemplo, foco visível, ordem/foco e mensagens de status); não classifique a existência ou ausência da função opcional de navegação por objetivo como requisito WCAG por si só.
5. Para cada achado, registre rota/estado e arquivo/componente/seletor; use linha de código quando confiável. Mantenha distintas as fontes `Código`, `axe`, `Navegador/manual` e `Documento/norma`.
6. Se a cobertura não permite avaliar um critério, não declare conforme nem N/A: marque `Requer revisão manual` ou `Não avaliado`, com o motivo.

## Brasil e aplicabilidade jurídica

Consulte fontes oficiais atuais quando citar legislação, regulamentação ou status de norma. Informe fonte e artigo/cláusula exatos. Separe requisito técnico WCAG de obrigação legal: não afirme que a LBI incorpora automaticamente cada critério WCAG ou que toda norma ABNT é obrigatória para qualquer produto.

- Lei Brasileira de Inclusão, Lei nº 13.146/2015, art. 63: trata da acessibilidade de sítios mantidos por empresas com sede ou representação comercial no Brasil e por órgãos de governo; §1º trata de símbolo de acessibilidade em destaque. Confirme o contexto do produto e relate esse requisito legal separadamente dos critérios WCAG. Se escopo ou consequência jurídica forem incertos, marque `⚠ REVISÃO JURÍDICA NECESSÁRIA`.
- ABNT NBR 17225:2025 trata de requisitos de acessibilidade em conteúdo e aplicações web. Verifique edição, errata e status atuais no Catálogo ABNT durante a auditoria. Não reproduza texto integral de norma protegida; cite apenas identificação/cláusula necessária e use a cópia oficial autorizada. Sua força obrigatória para aquele produto precisa ser confirmada pelo contexto legal, regulatório ou contratual.
- eMAG 3.1 é direcionado a sítios e portais do governo brasileiro/SISP. Use quando o produto estiver nesse escopo; não o trate automaticamente como obrigação para um produto privado sem contexto que justifique.
- Regras setoriais, contratos públicos, consumo, saúde, finanças e decisões judiciais podem mudar a aplicabilidade. Não invente interpretação jurídica nem prometa que correções evitam processo ou responsabilidade.

## Referências primárias para consultar

- [WCAG 2.2 — especificação normativa (W3C)](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2 — Quick Reference (W3C)](https://www.w3.org/WAI/WCAG22/quickref/)
- [Lei nº 13.146/2015 — texto consolidado, Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm)
- [ABNT NBR 17225 — Catálogo ABNT](https://www.abntcatalogo.com.br/) e [anúncio oficial da ABNT](https://abnt.org.br/lancamento-da-abnt-nbr-17225/)
- [eMAG 3.1 — portal oficial do Governo Digital](https://emag.governoeletronico.gov.br/)
