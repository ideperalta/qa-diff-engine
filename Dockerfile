# 1. Use the pre-packaged Microsoft environment
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# 2. Set the working folder inside the container
WORKDIR /app

# 3. Copy your project settings and install basic Node tools
COPY package*.json ./
RUN npm install

# 4. Copy the rest of your server code
COPY . .

# 5. Open the network port
EXPOSE 3000

# 6. Start the server
CMD ["node", "server.js"]
