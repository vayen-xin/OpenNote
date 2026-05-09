
  # OpenNote

  This is the browser client for OpenNote. The original visual draft came from https://www.figma.com/design/TYxLPvUDXoNEI0h0eUl4zz/Untitled.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Current Notes

  - The app now proxies both `/api` and `/uploads` in local development.
  - Question pages render Markdown image blocks stored in imported question banks.
  - Large banks use lazy loading: the sidebar loads a question index first, and the current question detail is fetched on demand with neighbor prefetching.
  
