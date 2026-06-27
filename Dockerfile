# --- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# --- Runtime stage (runs the example server) --------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm install tsx express
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/examples ./examples
EXPOSE 3000
CMD ["npx", "tsx", "examples/express-server.ts"]
