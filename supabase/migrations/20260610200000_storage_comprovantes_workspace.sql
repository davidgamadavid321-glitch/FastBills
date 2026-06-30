-- Etapa 4: comprovantes privados e isolados pelo primeiro segmento do path.

create or replace function public.uuid_seguro(valor text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return valor::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function public.uuid_seguro(text) from public;
revoke all on function public.uuid_seguro(text) from anon;
revoke all on function public.uuid_seguro(text) from authenticated;
grant execute on function public.uuid_seguro(text) to authenticated;
grant execute on function public.uuid_seguro(text) to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'comprovantes',
  'comprovantes',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname ilike '%comprovante%'
        or coalesce(qual, '') ilike '%comprovantes%'
        or coalesce(with_check, '') ilike '%comprovantes%'
      )
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      policy_record.policyname
    );
  end loop;
end;
$$;

create policy "Membros podem ler comprovantes do workspace"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.usuario_pertence_ao_workspace(
      public.uuid_seguro((storage.foldername(name))[1])
    )
  );

create policy "Membros podem inserir comprovantes no workspace"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'comprovantes'
    and public.usuario_pertence_ao_workspace(
      public.uuid_seguro((storage.foldername(name))[1])
    )
  );

create policy "Membros podem atualizar comprovantes do workspace"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.usuario_pertence_ao_workspace(
      public.uuid_seguro((storage.foldername(name))[1])
    )
  )
  with check (
    bucket_id = 'comprovantes'
    and public.usuario_pertence_ao_workspace(
      public.uuid_seguro((storage.foldername(name))[1])
    )
  );

create policy "Membros podem excluir comprovantes do workspace"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.usuario_pertence_ao_workspace(
      public.uuid_seguro((storage.foldername(name))[1])
    )
  );
