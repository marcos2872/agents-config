-- Catálogo de um schema em um único JSON: colunas, constraints e índices únicos.
-- Somente leitura. Usado por build.py (psql -At -v schema=<nome> -f), que passa o schema da configuração.
select json_agg(t) from (
  select c.relname as table,
    obj_description(c.oid) as comment,
    (select json_agg(json_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'nn', a.attnotnull,
        'def', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols,
    (select json_agg(json_build_object(
        'name', con.conname,
        'type', con.contype,
        'cols', (select json_agg(attname)
                   from unnest(con.conkey) with ordinality k(n, o)
                   join pg_attribute pa on pa.attrelid = con.conrelid and pa.attnum = k.n),
        'ref', case when con.contype = 'f' then con.confrelid::regclass::text end,
        'refcols', case when con.contype = 'f' then
                     (select json_agg(attname) from unnest(con.confkey) k(n)
                        join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = k.n) end,
        'ondelete', con.confdeltype,
        'def', pg_get_constraintdef(con.oid)))
      from pg_constraint con where con.conrelid = c.oid) as cons,
    (select json_agg(json_build_object('name', i.relname, 'unique', ix.indisunique, 'def', pg_get_indexdef(ix.indexrelid)))
      from pg_index ix join pg_class i on i.oid = ix.indexrelid
      where ix.indrelid = c.oid and ix.indisunique and not ix.indisprimary) as uidx
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = :'schema' and c.relkind = 'r'
  order by c.relname
) t;
