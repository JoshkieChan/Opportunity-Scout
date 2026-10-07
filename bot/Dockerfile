FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=pwuser:pwuser *.js ./
USER pwuser
CMD ["node", "index.js"]
