export function localISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Retorna o status correto para persistência no banco.
// 'hoje' não é um valor válido — lançamentos do dia atual ficam 'pendente'
// e a UI deriva o label "Vence hoje" via statusEfetivo() em tempo real.
export function calcularStatus(vencimento) {
  const hoje = localISODate(new Date())
  return vencimento < hoje ? 'vencido' : 'pendente'
}
