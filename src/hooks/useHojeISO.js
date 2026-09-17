import { useEffect, useState } from 'react'
import { localISODate } from '../lib/utils.js'

export function useHojeISO() {
  const [hoje, setHoje] = useState(() => localISODate(new Date()))

  useEffect(() => {
    let timer

    function agendarViradaDoDia() {
      const agora = new Date()
      const proximaMeiaNoite = new Date(
        agora.getFullYear(),
        agora.getMonth(),
        agora.getDate() + 1,
      )
      timer = setTimeout(() => {
        setHoje(localISODate(new Date()))
        agendarViradaDoDia()
      }, proximaMeiaNoite.getTime() - agora.getTime() + 100)
    }

    agendarViradaDoDia()
    return () => clearTimeout(timer)
  }, [])

  return hoje
}
