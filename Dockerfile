FROM node:22-alpine
ENV NODE_ENV=production TZ=Europe/Amsterdam PORT=3000 DATA_DIR=/data
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
