document.querySelector("#theme").addEventListener("change", (event) => {
  const theme = event.target.value;
  document.body.classList.toggle("dark", theme === "dark");
  document.querySelectorAll("img[data-page]").forEach((img) => {
    img.src = "./" + img.dataset.page + "-" + theme + ".png";
    img.parentElement.href = img.src;
  });
});
