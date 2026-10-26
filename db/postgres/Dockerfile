FROM postgres:18.4-bookworm
COPY scripts/primary-entrypoint.sh /usr/local/bin/verdant-primary-entrypoint.sh
COPY db/primary/ /docker-entrypoint-initdb.d/
COPY db/standby/entrypoint.sh /usr/local/bin/verdant-standby-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/verdant-primary-entrypoint.sh /usr/local/bin/verdant-standby-entrypoint.sh /docker-entrypoint-initdb.d/*.sh \
    && chmod 0755 /usr/local/bin/verdant-primary-entrypoint.sh /usr/local/bin/verdant-standby-entrypoint.sh /docker-entrypoint-initdb.d/*.sh
