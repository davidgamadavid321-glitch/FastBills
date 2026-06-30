const headers = {
  'Content-Type': 'application/json',
}

Deno.serve(() => new Response(
  JSON.stringify({ erro: 'webhook desativado' }),
  { status: 410, headers },
))
