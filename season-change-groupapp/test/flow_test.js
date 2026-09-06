// Verifies the no-roles redesign end to end:
//  - no role badge / role concept anywhere in the DOM
//  - every student answers every item individually, sees a comparison of
//    groupmates' answers, and ANY member (not just one "recorder") can
//    submit/revise the group's final answer
//  - lenient grading: "태양고도"/"태양의 고도" both match "태양 고도",
//    circled ㉠㉡ matches plain ㄱㄴ typed in any order, "가" matches "(가)"
//  - stations 3/4/6 show their reference photos (실험관찰/과학 images)
//  - ungraded (writing/discussion) stations submit as "done" with no
//    right/wrong pill, graded stations show done-ok/done-bad correctly
const { chromium } = require("playwright");
const BASE = "http://localhost:8843";

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const context = await browser.newContext();
  const errors = [];

  async function newStudentPage() {
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    p.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("404")) errors.push("console.error: " + msg.text());
    });
    await p.goto(BASE + "/student.html", { waitUntil: "domcontentloaded", timeout: 20000 });
    await p.waitForSelector('button[data-class="6-1"]', { timeout: 20000 });
    return p;
  }
  async function joinGroup(p, classId, groupNum, name) {
    await p.click(`button[data-class="${classId}"]`);
    await p.click(`button[data-group="${groupNum}"]`);
    await p.waitForSelector("#nameInput", { timeout: 5000 });
    await p.fill("#nameInput", name);
    await p.click("#nameNextBtn");
    await (await p.waitForSelector(".seat-btn:not(.taken)")).click();
    await p.waitForTimeout(200);
  }
  async function titleText(p) {
    return (await p.locator(".card h2").first().textContent()).trim();
  }

  console.log("== 3 students join 6-1 / group 3 (no roles) ==");
  const names = ["봄이", "여름이", "가을이"];
  const pages = [];
  for (const name of names) {
    const p = await newStudentPage();
    await joinGroup(p, "6-1", "3", name);
    pages.push(p);
  }
  const roleBadgeCount = await pages[0].locator(".role-badge").count();
  console.log("role-badge elements present (expect 0):", roleBadgeCount);

  // ---- Station 1: objective (blank + 3 OX), spelling-variant grading ----
  console.log("\n== Station 1 ==");
  console.log("title:", await titleText(pages[0]));
  const variants = ["태양 고도", "태양고도", "태양의 고도"]; // all should be treated as correct
  for (const [i, p] of pages.entries()) {
    await p.fill('.field[data-field="blank1"] input', variants[i]);
    await p.click('.field[data-field="ox1"] button[data-val="X"]');
    await p.click('.field[data-field="ox2"] button[data-val="O"]');
    await p.click('.field[data-field="ox3"] button[data-val="O"]');
    await p.click("#submitMine");
    await p.waitForTimeout(120);
  }
  const compareText = await pages[0].locator(".compare-table").innerText();
  console.log("compare table shows all 3 names:", names.every((n) => compareText.includes(n)));

  // ANY member (not a fixed "recorder") submits the final — try the 2nd student
  await pages[1].fill("#finalEditFields [data-field='blank1'] input", "태양고도"); // no-space variant
  await pages[1].click("#submitFinal");
  await pages[1].waitForTimeout(250);
  let pill = await pages[1].locator("#finalStatusPill").textContent();
  console.log("station1 final status with spelling variant (expect 정답):", pill.trim());

  // a DIFFERENT student (not the one who submitted) can revise it
  await pages[2].click("#reviseFinal");
  await pages[2].waitForTimeout(150);
  await pages[2].fill("#finalEditFields [data-field='blank1'] input", "태양의 고도"); // particle variant
  await pages[2].click("#submitFinal");
  await pages[2].waitForTimeout(250);
  pill = await pages[2].locator("#finalStatusPill").textContent();
  console.log("station1 final status after 3rd student revises with particle variant (expect 정답):", pill.trim());
  await pages[0].click("#goNext");
  await pages[0].waitForTimeout(300);
  console.log("advanced to:", await titleText(pages[0]));

  // ---- Station 2: circled-letter / order-independent grading ----
  console.log("\n== Station 2 (circled-letter grading) ==");
  const choiceInputs = ["㉠㉡", "ㄱㄴ", "ㄴㄱ"]; // circled, plain, reordered plain
  for (const [i, p] of pages.entries()) {
    await p.fill('.field[data-field="choice"] input', choiceInputs[i]);
    await p.click("#submitMine");
    await p.waitForTimeout(100);
  }
  await pages[0].fill("#finalEditFields [data-field='choice'] input", "ㄴㄱ"); // reordered plain jamo
  await pages[0].click("#submitFinal");
  await pages[0].waitForTimeout(250);
  pill = await pages[0].locator("#finalStatusPill").textContent();
  console.log("station2 final status with reordered plain jamo 'ㄴㄱ' (expect 정답):", pill.trim());
  await pages[0].click("#goNext");
  await pages[0].waitForTimeout(300);
  console.log("advanced to:", await titleText(pages[0]));

  // ---- Station 3: image present + "가" (no parens) matches "(가)" ----
  console.log("\n== Station 3 (지구 위치 그림 + 괄호 없는 정답) ==");
  const img3 = await pages[0].locator(".station-figure img").first();
  console.log("station3 shows a reference image (expect true):", await img3.isVisible());
  console.log("image alt text mentions 가/나 positions:", ((await img3.getAttribute("alt")) || "").includes("가"));
  for (const p of pages) {
    await p.fill('.field[data-field="axis"] input', "태양의 남중 고도");
    await p.fill('.field[data-field="position"] input', "가"); // no parentheses
    await p.fill('.field[data-field="energy"] textarea', "여름에 지표면이 받는 태양 에너지양이 겨울보다 많다.");
    await p.click("#submitMine");
    await p.waitForTimeout(100);
  }
  await pages[1].click("#submitFinal"); // defaults filled in from own individual answer
  await pages[1].waitForTimeout(250);
  pill = await pages[1].locator("#finalStatusPill").textContent();
  console.log("station3 final status with position='가' (no parens, expect 정답):", pill.trim());
  await pages[1].click("#goNext");
  await pages[0].waitForTimeout(300);
  console.log("advanced to:", await titleText(pages[0]));

  // ---- Station 4: ungraded writing station -> "제출 완료", has seasons image ----
  console.log("\n== Station 4 (과학글쓰기, 무채점) ==");
  const img4count = await pages[0].locator(".station-figure img").count();
  console.log("station4 reference image count (expect >=1):", img4count);
  for (const [i, p] of pages.entries()) {
    await p.fill('.field[data-field="essay"] textarea', `${names[i]}가 가장 좋아하는 계절은 여름입니다. 남중 고도가 높고 낮이 깁니다.`);
    await p.click("#submitMine");
    await p.waitForTimeout(100);
  }
  await pages[2].click("#submitFinal");
  await pages[2].waitForTimeout(250);
  pill = await pages[2].locator("#finalStatusPill").textContent();
  console.log("station4 final status (expect 제출 완료, no 정답/오답):", pill.trim());
  await pages[2].click("#goNext");
  await pages[0].waitForTimeout(300);
  console.log("advanced to:", await titleText(pages[0]));

  // ---- Station 5: discussion (단원 돌아보기), no image expected ----
  console.log("\n== Station 5 ==");
  const img5count = await pages[0].locator(".station-figure img").count();
  console.log("station5 image count (expect 0):", img5count);
  for (const p of pages) {
    await p.fill('.field[data-field="reflect"] textarea', "여름은 태양의 남중 고도가 높아 덥고, 겨울은 낮아 춥습니다.");
    await p.click("#submitMine");
    await p.waitForTimeout(100);
  }
  await pages[0].click("#submitFinal");
  await pages[0].waitForTimeout(250);
  await pages[0].click("#goNext");
  await pages[0].waitForTimeout(300);
  console.log("advanced to:", await titleText(pages[0]));

  // ---- Station 6: 앙부일구/원구일영, expects 2 images ----
  console.log("\n== Station 6 ==");
  const img6count = await pages[0].locator(".station-figure img").count();
  console.log("station6 image count (expect 2):", img6count);
  for (const p of pages) {
    await p.fill('.field[data-field="principle"] textarea', "앙부일구는 영침 그림자의 위치로, 원구일영은 시보 창의 글자로 시간을 알 수 있습니다.");
    await p.fill('.field[data-field="benefit"] textarea', "약속 시간을 정확히 지킬 수 있게 되었습니다.");
    await p.click("#submitMine");
    await p.waitForTimeout(100);
  }
  await pages[1].click("#submitFinal");
  await pages[1].waitForTimeout(250);
  await pages[1].click("#goNext");
  await pages[0].waitForTimeout(400);
  console.log("final screen (expect 완료 메시지):", await titleText(pages[0]).catch(() => "(no h2)"));

  console.log("\n== Teacher board ==");
  const teacherPage = await context.newPage();
  teacherPage.on("pageerror", (e) => errors.push("teacher pageerror: " + e.message));
  await teacherPage.goto(BASE + "/teacher.html", { waitUntil: "domcontentloaded" });
  await teacherPage.click('button[data-class="6-1"]');
  await teacherPage.waitForTimeout(400);
  const row3 = await teacherPage.locator(".board-table tr").nth(3).textContent();
  console.log("group3 row shows names, all stations complete:", row3.replace(/\s+/g, " ").trim());

  console.log("\n== Errors collected ==", errors.length ? errors : "NONE");
  await browser.close();
})();
