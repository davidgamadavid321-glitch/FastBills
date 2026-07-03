export const MENSAGEM_ERRO_ENVIO_TELEGRAM =
  'Não foi possível enviar o aviso pelo Telegram. Verifique as configurações e tente novamente.'

export async function enviarAvisosVencimento(supabase, tipo = 'manha') {
  const { data, error } = await supabase.functions.invoke('enviar-avisos-telegram', {
    body: { tipo, origem: 'manual' },
  })

  if (error) throw new Error(error.message || 'Erro ao chamar a funcao de avisos.')
  if (data?.ok === false) throw new Error(data?.erro || data?.mensagem || 'Erro ao enviar avisos.')

  return data
}
