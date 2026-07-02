FROM node:20-alpine

WORKDIR /app

# In docker-compose the source (incl. node_modules) is bind-mounted into /app
# and the service runs in watch mode, mirroring the api-gateway setup.
COPY . .

CMD ["npm", "run", "start:dev"]
