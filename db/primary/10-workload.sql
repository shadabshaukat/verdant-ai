\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE SCHEMA app;
CREATE SCHEMA ops;
REVOKE ALL ON SCHEMA app, ops FROM PUBLIC;
GRANT USAGE ON SCHEMA app, ops TO verdant_monitor, verdant_executor, verdant_demo;
CREATE TABLE app.customers (
 id bigint PRIMARY KEY,
 name text NOT NULL,
 region text NOT NULL
);
CREATE TABLE app.orders (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id bigint NOT NULL REFERENCES app.customers(id),
 status text NOT NULL CHECK (status IN ('pending','paid','shipped')),
 amount numeric(12,2) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 padding text NOT NULL
) WITH (autovacuum_enabled = false);
INSERT INTO app.customers SELECT n, 'Customer '||n, (ARRAY['Sydney','Melbourne','Perth','Brisbane'])[1+n%4] FROM generate_series(1,2500) n;
INSERT INTO app.orders(customer_id,status,amount,padding)
 SELECT 1+n%2500, (ARRAY['pending','paid','shipped'])[1+n%3], (n%99999)::numeric/100, repeat(md5(n::text),8) FROM generate_series(1,75000) n;
CREATE TABLE ops.heartbeat(id integer PRIMARY KEY CHECK (id=1), updated_at timestamptz NOT NULL, sequence bigint NOT NULL DEFAULT 0);
INSERT INTO ops.heartbeat VALUES (1,clock_timestamp(),0);
CREATE TABLE ops.demo_fixture(name text PRIMARY KEY,active boolean NOT NULL DEFAULT false,changed_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO ops.demo_fixture(name) VALUES ('stale-statistics'),('replication-pause'),('blocked-query'),('risky-role'),('slow-query');
GRANT SELECT ON app.customers, app.orders, ops.heartbeat, ops.demo_fixture TO verdant_monitor;
GRANT SELECT, UPDATE ON app.orders TO verdant_demo;
GRANT SELECT ON app.customers, ops.heartbeat, ops.demo_fixture TO verdant_demo;

CREATE FUNCTION ops.touch_heartbeat() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Heartbeat only writes to the primary'; END IF;
 UPDATE ops.heartbeat SET updated_at=clock_timestamp(),sequence=sequence+1 WHERE id=1;
 SELECT jsonb_build_object('updated_at',updated_at,'sequence',sequence) INTO v FROM ops.heartbeat WHERE id=1;
 RETURN v;
END $$;
CREATE FUNCTION ops.analyze_demo_table() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'ANALYZE requires the primary'; END IF;
 ANALYZE app.orders;
 UPDATE ops.demo_fixture SET active=false,changed_at=clock_timestamp() WHERE name='stale-statistics';
 RETURN jsonb_build_object('table','app.orders','analyzed_at',clock_timestamp());
END $$;
CREATE FUNCTION ops.set_stale_statistics(p_active boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Fixture requires primary'; END IF;
 IF p_active THEN
  UPDATE app.orders SET updated_at=clock_timestamp(),amount=amount+0.01 WHERE id<=10000;
 ELSE
  ANALYZE app.orders;
 END IF;
 UPDATE ops.demo_fixture SET active=p_active,changed_at=clock_timestamp() WHERE name='stale-statistics';
 PERFORM pg_stat_force_next_flush();
 RETURN jsonb_build_object('fixture','stale-statistics','active',p_active,'affected_rows',10000);
END $$;
CREATE FUNCTION ops.set_risky_role(p_active boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Fixture requires primary'; END IF;
 IF p_active THEN ALTER ROLE verdant_risky_login CREATEROLE; ELSE ALTER ROLE verdant_risky_login NOCREATEROLE; END IF;
 UPDATE ops.demo_fixture SET active=p_active,changed_at=clock_timestamp() WHERE name='risky-role';
 RETURN jsonb_build_object('role','verdant_risky_login','createrole',p_active);
END $$;
CREATE FUNCTION ops.restrict_demo_role() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Role remediation requires primary'; END IF;
 ALTER ROLE verdant_risky_login NOCREATEROLE;
 UPDATE ops.demo_fixture SET active=false,changed_at=clock_timestamp() WHERE name='risky-role';
 RETURN jsonb_build_object('role','verdant_risky_login','createrole',false,'verified_at',clock_timestamp());
END $$;
CREATE FUNCTION ops.pause_replication() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF NOT pg_is_in_recovery() THEN RAISE EXCEPTION 'Only the disposable standby can pause replay'; END IF;
 PERFORM pg_wal_replay_pause();
 RETURN jsonb_build_object('replay_paused',pg_is_wal_replay_paused());
END $$;
CREATE FUNCTION ops.resume_replication() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF NOT pg_is_in_recovery() THEN RAISE EXCEPTION 'Only the disposable standby can resume replay'; END IF;
 PERFORM pg_wal_replay_resume();
 RETURN jsonb_build_object('replay_paused',pg_is_wal_replay_paused());
END $$;
CREATE FUNCTION ops.cancel_demo_blocker() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
DECLARE v_pids integer[];
BEGIN
 SELECT coalesce(array_agg(pid),ARRAY[]::integer[]) INTO v_pids FROM pg_stat_activity
  WHERE datname=current_database() AND usename='verdant_demo' AND application_name='verdant-demo-blocker'
   AND pid<>pg_backend_pid() AND backend_type='client backend';
 PERFORM pg_terminate_backend(pid) FROM unnest(v_pids) pid;
 UPDATE ops.demo_fixture SET active=false,changed_at=clock_timestamp() WHERE name='blocked-query';
 RETURN jsonb_build_object('terminated_pids',v_pids,'scope','verdant-demo-blocker only');
END $$;
CREATE FUNCTION ops.set_fixture_flag(p_name text,p_active boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF p_name NOT IN ('blocked-query','slow-query') THEN RAISE EXCEPTION 'Unknown fixture flag'; END IF;
 UPDATE ops.demo_fixture SET active=p_active,changed_at=clock_timestamp() WHERE name=p_name;
 RETURN jsonb_build_object('fixture',p_name,'active',p_active);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.touch_heartbeat(),ops.analyze_demo_table(),ops.resume_replication(),ops.cancel_demo_blocker(),ops.restrict_demo_role() TO verdant_executor;
GRANT EXECUTE ON FUNCTION ops.set_stale_statistics(boolean),ops.set_risky_role(boolean),ops.pause_replication(),ops.resume_replication(),ops.cancel_demo_blocker(),ops.set_fixture_flag(text,boolean) TO verdant_demo;
ANALYZE app.orders;
ANALYZE app.customers;

CREATE FUNCTION ops.create_demo_index() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Index tuning requires primary'; END IF;
 CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON app.orders(customer_id);
 ANALYZE app.orders;
 UPDATE ops.demo_fixture SET active=false,changed_at=clock_timestamp() WHERE name='slow-query';
 RETURN jsonb_build_object('index','app.orders_customer_id_idx','table','app.orders','method','ordinary demo index build','created_at',clock_timestamp());
END $$;
CREATE FUNCTION ops.drop_demo_index() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ops,pg_temp AS $$
BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Fixture requires primary'; END IF;
 DROP INDEX IF EXISTS app.orders_customer_id_idx;
 UPDATE ops.demo_fixture SET active=true,changed_at=clock_timestamp() WHERE name='slow-query';
 RETURN jsonb_build_object('fixture','slow-query','index_present',false);
END $$;
REVOKE ALL ON FUNCTION ops.create_demo_index(),ops.drop_demo_index() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.create_demo_index() TO verdant_executor;
GRANT EXECUTE ON FUNCTION ops.drop_demo_index() TO verdant_demo;
