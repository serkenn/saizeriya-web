const url = "https://ioes.saizeriya.co.jp/saizeriya2/src/cmd/get_item.php";

const body = new URLSearchParams({
  sid: "20",
  tno: "1",
  lng: "1",
  id: "1202",
  num: "1",
});

const res = await fetch(url, {
  method: "POST",
  headers: {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "origin": "https://ioes.saizeriya.co.jp",
    "referer": "https://ioes.saizeriya.co.jp/saizeriya2/",
    "x-requested-with": "XMLHttpRequest",

    // 必要なら。セッション情報なので公開しないこと
  },
  body,
});

console.log(res.status, res.statusText);

const text = await res.text();
console.log(text);