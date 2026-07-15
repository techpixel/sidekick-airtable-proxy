FROM oven/bun:1-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
