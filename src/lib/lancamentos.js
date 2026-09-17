export const EVENTO_LANCAMENTOS_ATUALIZADOS = 'gestaosmart:lancamentos-atualizados'

export function notificarLancamentosAtualizados() {
  window.dispatchEvent(new Event(EVENTO_LANCAMENTOS_ATUALIZADOS))
}
