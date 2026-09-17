export function localISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dataVencimentoNoMes(ano, mes, diaBase) {
  const anoNumero = Number(ano)
  const mesNumero = Number(mes)
  const diaNumero = Number(diaBase)

  if (!Number.isInteger(anoNumero)) return ''
  if (!Number.isInteger(mesNumero) || mesNumero < 1 || mesNumero > 12) return ''
  if (!Number.isInteger(diaNumero) || diaNumero < 1 || diaNumero > 31) return ''

  const ultimoDia = new Date(anoNumero, mesNumero, 0).getDate()
  return localISODate(new Date(anoNumero, mesNumero - 1, Math.min(diaNumero, ultimoDia)))
}

export function normalizarDataISO(valor) {
  return String(valor ?? '').slice(0, 10)
}

export function statusEfetivo(vencimento, status, hoje = localISODate(new Date())) {
  const vencimentoISO = normalizarDataISO(vencimento)
  if (status === 'pago') return 'pago'
  if (!vencimentoISO) return 'pendente'
  if (status === 'vencido' || vencimentoISO < hoje) return 'vencido'
  if (vencimentoISO === hoje) return 'hoje'
  return 'pendente'
}

export function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(valor ?? 0))
}

// Retorna o status correto para persistência no banco.
// 'hoje' não é um valor válido — lançamentos do dia atual ficam 'pendente'
// e a UI deriva o label "Vence hoje" via statusEfetivo() em tempo real.
export function calcularStatus(vencimento, hoje = localISODate(new Date())) {
  return vencimento < hoje ? 'vencido' : 'pendente'
}
