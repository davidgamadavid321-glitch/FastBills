import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const WorkspaceContext = createContext(null)

export function WorkspaceProvider({ user, children }) {
  const [workspace, setWorkspace] = useState(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [erroWorkspace, setErroWorkspace] = useState('')
  const mountedRef = useRef(false)
  const requestRef = useRef(0)

  const carregarWorkspace = useCallback(async () => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    const isCurrentRequest = () => mountedRef.current && requestRef.current === requestId

    if (!user) {
      if (isCurrentRequest()) {
        setWorkspace(null)
        setErroWorkspace('')
        setLoadingWorkspace(false)
      }
      return
    }

    if (isCurrentRequest()) {
      setLoadingWorkspace(true)
      setErroWorkspace('')
    }

    const { data: memberships, error: erroMemberships } = await supabase
      .from('workspace_members')
      .select('workspace_id, papel')
      .eq('user_id', user.id)

    if (!isCurrentRequest()) return

    if (erroMemberships) {
      setWorkspace(null)
      setErroWorkspace('Não foi possível carregar seu espaço de trabalho.')
      setLoadingWorkspace(false)
      return
    }

    if (!memberships || memberships.length === 0) {
      setWorkspace(null)
      setErroWorkspace('Sua conta ainda não tem um espaço de trabalho configurado.')
      setLoadingWorkspace(false)
      return
    }

    if (memberships.length > 1) {
      setWorkspace(null)
      setErroWorkspace('Sua conta tem mais de um espaço de trabalho. A seleção será liberada em breve.')
      setLoadingWorkspace(false)
      return
    }

    const membership = memberships[0]
    const { data: workspaceData, error: erroWorkspaceData } = await supabase
      .from('workspaces')
      .select('id, nome, criado_por, criado_em, atualizado_em')
      .eq('id', membership.workspace_id)
      .single()

    if (!isCurrentRequest()) return

    if (erroWorkspaceData || !workspaceData) {
      setWorkspace(null)
      setErroWorkspace('Não encontramos seu espaço de trabalho. Entre novamente ou fale com o suporte.')
      setLoadingWorkspace(false)
      return
    }

    setWorkspace({ ...workspaceData, papel: membership.papel })
    setLoadingWorkspace(false)
  }, [user])

  useEffect(() => {
    mountedRef.current = true
    carregarWorkspace()
    return () => {
      mountedRef.current = false
      requestRef.current += 1
    }
  }, [carregarWorkspace])

  const value = useMemo(() => ({
    workspace,
    workspaceId: workspace?.id ?? null,
    loadingWorkspace,
    erroWorkspace,
    recarregarWorkspace: carregarWorkspace,
  }), [workspace, loadingWorkspace, erroWorkspace, carregarWorkspace])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace deve ser usado dentro de WorkspaceProvider')
  }
  return context
}
