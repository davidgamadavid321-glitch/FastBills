import { calcularStatus, dataVencimentoNoMes, localISODate } from './utils.js'

export function gerarLancamentosIniciais({
  recorrencia,
  anoBase,
  mesBase,
  diaBase,
  valor,
  dataUnica,
  hoje = localISODate(new Date()),
}) {
  if (recorrencia === 'uma_vez') {
    return [{
      valor,
      vencimento: dataUnica ?? dataVencimentoNoMes(anoBase, mesBase, diaBase),
      status: calcularStatus(dataUnica ?? dataVencimentoNoMes(anoBase, mesBase, diaBase), hoje),
    }]
  }

  if (recorrencia === 'mensal') {
    return Array.from({ length: 12 }, (_, indice) => {
      const competencia = new Date(anoBase, mesBase - 1 + indice, 1)
      const vencimento = dataVencimentoNoMes(
        competencia.getFullYear(),
        competencia.getMonth() + 1,
        diaBase,
      )
      return { valor, vencimento, status: calcularStatus(vencimento, hoje) }
    })
  }

  const anoAtual = Number(hoje.slice(0, 4))
  return Array.from({ length: 6 }, (_, indice) => {
    const vencimento = dataVencimentoNoMes(anoAtual + indice, mesBase, diaBase)
    return { valor, vencimento, status: calcularStatus(vencimento, hoje) }
  })
}
