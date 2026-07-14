-- Remove a unicidade global de public.titulares.cor.
-- A cor e apenas um atributo visual (paleta fixa) e nao deve bloquear
-- o cadastro de titulares com a mesma cor, nem dentro nem fora do workspace.
-- Nao substitui por UNIQUE (workspace_id, cor): dois titulares do mesmo
-- workspace podem usar a mesma cor sem erro.

alter table public.titulares
  drop constraint if exists titulares_cor_key;

-- Defesa extra: remove qualquer indice unico remanescente que cubra
-- somente a coluna "cor" e nao esteja mais associado a uma constraint
-- nomeada (ex.: criado manualmente via `create unique index`, fora de
-- uma constraint com nome proprio).
do $$
declare
  indice record;
begin
  for indice in
    select i.relname as nome_indice
    from pg_index idx
    join pg_class i on i.oid = idx.indexrelid
    join pg_class t on t.oid = idx.indrelid
    where t.oid = 'public.titulares'::regclass
      and idx.indisunique
      and not exists (
        select 1
        from pg_constraint c
        where c.conindid = idx.indexrelid
      )
      and (
        select array_agg(attname order by attnum)
        from pg_attribute
        where attrelid = t.oid
          and attnum = any(idx.indkey)
      ) = array['cor']::name[]
  loop
    execute format('drop index if exists public.%I', indice.nome_indice);
    raise notice 'Indice unico solto removido de titulares.cor: %', indice.nome_indice;
  end loop;
end;
$$;
