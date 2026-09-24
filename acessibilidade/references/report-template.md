# Modelo do relatório `/acessibilidade`

Grave uma cópia preenchida em `docs/accessibility/audit-YYYY-MM-DD.md`. Preserve relatórios existentes. O relatório deve ser útil para uma equipe implementar e confirmar correções sem confundir achado automatizado com conclusão normativa.

```markdown
# Auditoria de acessibilidade — <nome do sistema>

- Data:
- Projeto/versão/commit:
- Base técnica: WCAG 2.2, níveis A e AA
- Referências brasileiras consideradas:
- Escopo: rotas, diálogos/estados, fluxos e breakpoints
- Cobertura: páginas/estados conhecidos; inspecionados; não acessados
- Métodos: análise de código, ferramenta/versão, navegador, teste manual
- Limitações e dependências de autenticação:
- Status geral: <sem conclusão de conformidade / barreiras obrigatórias encontradas / critérios no escopo revisados>

## Resumo executivo

<Achados prioritários e o que a cobertura permite concluir. Não declare conformidade AA se critérios aplicáveis não foram avaliados.>

## Plano priorizado

<Ordene: obrigatórios críticos; demais obrigatórios; obrigatórios quando aplicáveis; recomendados; opcionais. Indique dependências e valide itens críticos primeiro.>

## Achados

### <ID> — <título curto>

- CLASSIFICAÇÃO: 🔴 [OBRIGATÓRIO] | 🟠 [OBRIGATÓRIO QUANDO APLICÁVEL] | 🟡 [RECOMENDADO] | ⚪ [OPCIONAL]
- PRIORIDADE: Crítica / Alta / Normal (urgência do impacto, separada da classificação normativa)
- FONTE: WCAG / legislação / norma / boa prática
- REFERÊNCIA: <critério e nível exatos ou artigo/cláusula>
- APLICABILIDADE: <por que se aplica; ou evidência e motivo de N/A>
- PROBLEMA: <barreira observável e quem pode ser afetado>
- LOCAL: <rota/estado, arquivo/componente/seletor/linha quando disponível>
- EVIDÊNCIA: <código, resultado axe, observação manual ou referência>
- CORREÇÃO: <mudança específica e estrutural>
- VALIDAÇÃO: <passos e resultado esperado para confirmar>
- STATUS: Pendente / Corrigido / N/A / Requer revisão manual / Requer revisão jurídica / Não avaliado

## Matriz WCAG 2.2 A/AA

| Critério/requisito | Classificação | Fonte | Status | Evidência / motivo de N/A |
|---|---|---|---|---|
| <inclua todos os critérios de sucesso A e AA; uma linha por critério> | <um rótulo exato> | WCAG 2.2 — <SC> | Conforme / Não conforme / N/A / Requer revisão manual / Não avaliado | <rota/teste/evidência ou motivo verificável> |

## Matriz de funcionalidades condicionais e requisitos brasileiros

| Funcionalidade/requisito | Classificação | Fonte | Status | Evidência / motivo de N/A |
|---|---|---|---|---|
| <formulário, diálogo, vídeo, autenticação, conteúdo dinâmico, etc.; incluir apenas o que existe ou foi verificado> | <rótulo exato> | <critério/artigo/norma> | <status> | <evidência> |

## Recomendações e itens opcionais

<Separe claramente; a ausência desses itens não reprova AA.>

## Revisão jurídica necessária

<Questão pendente e fatos que um profissional precisa confirmar; ou “Não identificada nesta análise técnica”.>

## Limitações e próximos passos

<Estados não capturados, testes manuais pendentes, combinações de tecnologia assistiva ainda não verificadas.>
```

Preencha a matriz com todos os critérios WCAG 2.2 A e AA e os requisitos legais/normativos considerados; não deixe linhas em branco como se tivessem sido avaliadas. Para itens fora da cobertura, use `Não avaliado` e explique a limitação. Use `N/A` apenas quando a inexistência ou inaplicabilidade estiver documentada.
