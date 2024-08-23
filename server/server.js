require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const cookieparser = require("cookie-parser");
const { Client } = require("@notionhq/client");

const port = process.env.PORT;

const googleClientID = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

const notionClientID = process.env.NOTION_CLIENT_ID;
const notionClientSecret = process.env.NOTION_CLIENT_SECRET;
const notionAuthURL = process.env.NOTION_AUTH_URL;
const notionDatabaseID = process.env.NOTION_DATABASE_ID;

const jwt_secret = process.env.JWT_SECRET;
const callBackURI = "http://localhost:3000/google-oauth2callback";
const scope = ["https://www.googleapis.com/auth/tasks"];

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(cookieparser());
app.use(express.json());

const oauth2client = new google.auth.OAuth2(
  googleClientID,
  googleClientSecret,
  callBackURI
);

// used to generate the url to take consent from the user
app.get("/google-auth-url", (req, res) => {
  const authURL = oauth2client.generateAuthUrl({
    access_type: "offline",
    scope: scope,
    prompt: "consent",
  });

  res.json({ authURL });
});

// after the user has given the consent for google account, this endpoint will be called
// a code wil be generated and using that code, a google access token and refresh token will be generated
// after that, to take consent about his notion account, user will be redirected to another url
app.get("/google-oauth2callback", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2client.getToken(code);

  const googleAccessToken = jwt.sign(
    { accessToken: tokens.access_token },
    jwt_secret,
    {
      expiresIn: "1h",
    }
  );

  const googleRefreshToken = jwt.sign(
    { refreshToken: tokens.refresh_token },
    jwt_secret
  );

  res.cookie("googleAccessToken", googleAccessToken, {
    httpOnly: true,
  });

  res.cookie("googleRefreshToken", googleRefreshToken, {
    httpOnly: true,
  });

  res.redirect(notionAuthURL);
});

// after the user has given the consent for notion account, this endpoint will be called
// a code wil be generated and using that code, a notion access token will be generated
// after that, user will be redirected to tasks page
app.get("/notion-oauth2callback", async (req, res) => {
  const { code } = req.query;

  const encoded = Buffer.from(
    `${notionClientID}:${notionClientSecret}`
  ).toString("base64");

  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${encoded}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "http://localhost:3000/notion-oauth2callback",
    }),
  });

  const data = await response.json();

  const notionAccessToken = jwt.sign(
    { accessToken: data.access_token },
    jwt_secret
  );

  res.cookie("notionAccessToken", notionAccessToken, {
    httpOnly: true,
  });

  res.redirect("http://localhost:5173/tasks");
});

// the access tokens and refresh token are stored in a http-only cookie after encryptig them in a jwt for safety purposes
// to store then in a state, this endpoint will be called
app.post("/get-access-tokens", (req, res) => {
  const { googleAccessToken, googleRefreshToken, notionAccessToken } =
    req.cookies;
  res.json({ googleAccessToken, googleRefreshToken, notionAccessToken });
});

// this endpoint will be called if the google access token is expired to create a new access token using a refresh token
app.post("/refresh-token", (req, res) => {
  const token = jwt.verify(req.cookies.googleRefreshToken, jwt_secret);
  const refreshToken = token.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: "No refresh token provided." });
  }
  oauth2client.setCredentials({ refresh_token: refreshToken });
  oauth2client
    .getAccessToken()
    .then(({ token }) => {
      const newGoogleAccessToken = jwt.sign(
        { accessToken: token },
        jwt_secret,
        {
          expiresIn: "1h",
        }
      );

      res.status(200).json({ googleAccessToken: newGoogleAccessToken });
    })
    .catch((error) => {
      console.error("Error refreshing access token:", error);
      res.status(500).json({ error: "Failed to refresh access token." });
    });
});

// this endpoint will be called to fetch task lists from Google Tasks API using the google access token
app.get("/get-tasklists", (req, res) => {
  try {
    const token = jwt.verify(
      req.headers.authorization.split(" ")[1],
      jwt_secret
    );
    const accessToken = token.accessToken;
    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
      .then((response) => response.json())
      .then((data) => {
        res.status(200).json({ tasks: data.items });
      })
      .catch((error) => {
        console.log("Error fetching tasks from Google Tasks API: ", error);
        res.status(500).json({ error: "Failed to fetch tasks" });
      });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    } else {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

// this endpoint will be called to query a notion database to fetch how many pages it contains
app.post("/get-notion-database", async (req, res) => {
  const token = jwt.verify(req.cookies.notionAccessToken, jwt_secret);
  const accessToken = token.accessToken;
  const notion = new Client({ auth: accessToken });
  const response = await notion.databases.query({
    database_id: notionDatabaseID,
    sorts: [
      {
        property: "Created at",
        direction: "ascending",
      },
    ],
  });
  if (response.results.length == 0) {
    res.json({ notionPages: [] });
  } else {
    const notionPages = response.results.map((result) => ({
      taskID: result.properties["Task ID"].rich_text[0].text.content,
      title: result.properties.Title.title[0].plain_text,
      createdAt: result.properties["Created at"].date.start,
    }));
    res.json({ notionPages });
  }
});

// this endpoint will be called to create notion page for every tasks not present in the notion database
app.post("/create-notion-page", async (req, res) => {
  const { task } = req.body;
  const token = jwt.verify(req.cookies.notionAccessToken, jwt_secret);
  const accessToken = token.accessToken;
  const notion = new Client({ auth: accessToken });
  const response = await notion.pages.create({
    parent: {
      type: "database_id",
      database_id: notionDatabaseID,
    },
    properties: {
      "Task ID": {
        rich_text: [
          {
            text: { content: task.id },
          },
        ],
      },
      Title: {
        title: [
          {
            text: { content: task.title },
          },
        ],
      },
      "Created at": {
        date: {
          start: task.updated,
        },
      },
    },
  });
  res.status(200).json({ response });
});

app.listen(port, () => {
  console.log(`Server listening at port ${port}`);
});
