FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Create unprivileged runtime user for Chromium sandbox compatibility
RUN useradd -m -u 10001 -s /usr/sbin/nologin opia && \
    chown -R opia:opia /app

USER opia
ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "src/index.js"]
