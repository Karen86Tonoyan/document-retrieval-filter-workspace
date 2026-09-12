insert into public.user_roles (user_id, role)
select id, 'provider'::app_role from auth.users where email = 'ktono1986@gmail.com'
on conflict (user_id, role) do nothing;