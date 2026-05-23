# StockGrader — Backend

Express REST API for StockGrader, a web app that grades publicly traded stocks A–F based on five fundamental financial criteria sourced from Yahoo Finance.

## Prerequisites

- Node.js installed
- MongoDB Atlas account and connection string

## Setup

1. Clone the repository
   git clone https://github.com/Cory71/stock-advisor-backend.git

2. Install dependencies
   npm install

3. Create a .env file in the root and add the following:
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_secret_key

4. Start the server
   npm run dev

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | / | Health check |

More endpoints will be added as development progresses.
