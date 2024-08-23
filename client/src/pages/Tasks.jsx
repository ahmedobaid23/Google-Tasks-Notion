import { useEffect, useState } from "react";

const Tasks = () => {
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [notionAccessToken, setNotionAccessToken] = useState("");
  const [tasks, setTasks] = useState([]);
  const [tasksCopy, setTasksCopy] = useState(tasks);
  const [notionPages, setNotionPages] = useState([]);
  const [notionPagesCopy, setNotionPagesCopy] = useState(notionPages);
  const [notionPageIds, setNotionPageIds] = useState(new Set()); // this will be used to generate new notion pages based on the IDs of tasks
  const [loading, setLoading] = useState(true);

  // function to fetch google tasks from Google Tasks API
  const fetchTasks = async () => {
    try {
      const response = await fetch("http://localhost:3000/get-tasklists", {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      });
      const data = await response.json();

      if (response.ok) {
        // token is not expired
        setTasks(data.tasks);
        console.log("Tasks: ", data.tasks);
      } else if (response.status === 401 || response.status === 500) {
        // token is expired so we will use the refresh token to create a new access token
        const refreshResponse = await fetch(
          "http://localhost:3000/refresh-token",
          {
            method: "POST",
            credentials: "include",
          }
        );
        const refreshData = await refreshResponse.json();

        if (refreshResponse.ok) {
          setGoogleAccessToken(refreshData.googleAccessToken);
        } else {
          console.error(refreshData.error);
        }
      }
    } catch (error) {
      console.log("Error occurred while fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  // function to query notion database from Notion API
  const getNotionDatabase = () => {
    fetch("http://localhost:3000/get-notion-database", {
      method: "POST",
      credentials: "include",
    }).then((response) =>
      response.json().then((data) => {
        setNotionPages(data.notionPages);
        setNotionPageIds(new Set(data.notionPages.map((page) => page.taskID)));
        console.log("Notion Pages: ", data.notionPages);
      })
    );
  };

  // function to create a notion page in the notion database
  const createNotionPage = (task) => {
    fetch("http://localhost:3000/create-notion-page", {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        task: task,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        console.log(data);
      })
      .catch((error) => console.error("Error:", error));
  };

  // this will run on mount to fetch access tokens of both apis for making the requests
  useEffect(() => {
    const getAccessTokens = async () => {
      const response = await fetch("http://localhost:3000/get-access-tokens", {
        method: "POST",
        credentials: "include",
      });

      const data = await response.json();
      setGoogleAccessToken(data.googleAccessToken);
      setNotionAccessToken(data.notionAccessToken);
    };

    if (!notionAccessToken) {
      getAccessTokens();
    }
  }, []);

  // this effect will run every time google access token changes because it has a short life span of 1 hour
  // used to fetch tasks from google tasks api
  useEffect(() => {
    if (googleAccessToken) {
      fetchTasks();

      const intervalId = setInterval(fetchTasks, 10000);
      return () => clearInterval(intervalId);
    }
  }, [googleAccessToken]);

  // created a copy of google tasks state because the original state is always set on every function call
  // copy will change only if both the states (original and copy) are not equal
  // used to reduce re-renders
  useEffect(() => {
    if (tasks.length !== tasksCopy.length) {
      setTasksCopy(tasks);
    }
  }, [tasks]);

  // this effect will query the notion database every time tasks state changes
  useEffect(() => {
    getNotionDatabase();
  }, [tasks]);

  // created a copy of notion pages state because the original state is always set on every function call
  // copy will change only if both the states (original and copy) are not equal
  // used to reduce re-renders and call the api if all the notion pages are deleted
  useEffect(() => {
    console.log("Notion Page IDs:", notionPageIds);
    if (notionPages.length !== notionPagesCopy.length) {
      setNotionPagesCopy(notionPages);
    }
  }, [notionPages]);

  // used to create notion pages for the tasks not existing on the notion database using the notionPagesIds
  useEffect(() => {
    if (notionPages.length < tasks.length) {
      const newTasks = tasks.filter((task) => !notionPageIds.has(task.id));

      newTasks.forEach((task) => {
        createNotionPage(task);
      });
    }
  }, [tasksCopy, notionPagesCopy]); // first dependency makes sure that if a new task is created on Google Tasks, it is alsi added to notion database
  // second dependency makes sure that if we delete the notion pages manually from notion, it is synchronized with the google tasks

  return (
    <div>
      <h1>Tasks</h1>
      {!loading ? (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>{task.title}</li>
          ))}
        </ul>
      ) : (
        <p>Loading ...</p>
      )}
    </div>
  );
};

export default Tasks;
