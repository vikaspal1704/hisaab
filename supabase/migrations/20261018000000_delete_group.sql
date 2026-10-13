-- Hisaab v7: delete or leave a group.
-- Deleting a group never changes anyone's money: its expenses and payments stay
-- in everyone's balances and passbooks, just without the group label.
-- Repeating bills, car pool trips and shortcuts for the group go with it.
-- Additive; safe to run on a live database.

-- Only the person who created the group can delete it.
create function public.delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_group public.groups;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found or not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if v_group.created_by <> v_me then
    raise exception 'only_group_creator' using errcode = 'P0001';
  end if;
  -- entries.group_id is "on delete set null": the history stays, unlabelled.
  delete from public.groups where id = p_group;
end;
$$;

-- Anyone but the creator can leave, once they're square in this group and
-- not holding its kitty. Their past entries stay where they are.
create function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := public.require_me();
  v_group public.groups;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found or not public.is_group_member(p_group) then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if v_group.created_by = v_me then
    raise exception 'creator_cannot_leave' using errcode = 'P0001';
  end if;
  if v_group.kitty_holder = v_me
     or coalesce((select net from public.group_balances(p_group) where person_id = v_me), 0) <> 0 then
    raise exception 'settle_before_leaving' using errcode = 'P0001';
  end if;
  delete from public.group_members where group_id = p_group and person_id = v_me;
end;
$$;

revoke execute on function public.delete_group(uuid), public.leave_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid), public.leave_group(uuid) to authenticated;
