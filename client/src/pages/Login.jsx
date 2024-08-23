import { useEffect, useState } from "react";

// used to create a url to take consent from the user about his notion and google account
// this will result in a code, which will be used to generate an access token
const Login = () => {
  const [googleAuthURL, setGoogleAuthURL] = useState("");
  useEffect(() => {
    fetch("http://localhost:3000/google-auth-url").then((response) =>
      response
        .json()
        .then((data) => setGoogleAuthURL(data.authURL))
        .catch((error) => {
          console.log(error);
        })
    );
  }, []);

  return (
    <div>
      <h1>Google and Notion</h1>
      {googleAuthURL && (
        <a href={googleAuthURL}>Authenticate with Google and Notion</a>
      )}
    </div>
  );
};

export default Login;
