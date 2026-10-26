FROM postgres:18.4-bookworm AS build
ARG PGVECTOR_VERSION=0.8.7
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates curl postgresql-server-dev-18 \
    && curl --fail --location --retry 3 "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" -o /tmp/pgvector.tar.gz \
    && mkdir /tmp/pgvector \
    && tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1 \
    && make -C /tmp/pgvector OPTFLAGS="" \
    && make -C /tmp/pgvector install

FROM postgres:18.4-bookworm
COPY --from=build /usr/lib/postgresql/18/lib/vector.so /usr/lib/postgresql/18/lib/vector.so
COPY --from=build /usr/share/postgresql/18/extension/vector* /usr/share/postgresql/18/extension/
