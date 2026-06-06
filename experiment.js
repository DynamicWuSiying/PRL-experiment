// =============================================================================
// 配置常量
// =============================================================================
const CONFIG = {
  timings: {
    fixation: 500,
    response: 3000,
    feedback: 700
  },
  keys: { match: "j", nonmatch: "f", house: "j", face: "f" },
  nback_trials: 16,
  nback_practice_trials: 10,
  image_practice_trials: 12,
  nback_target_ratio: 0.3,
  max_practice_rounds: 3
};

// =============================================================================
// 全局变量
// =============================================================================
let subject_id = "unknown";
let practice_round = 1;
let repeat_practice = false;
let nback_history = [];

// =============================================================================
// jsPsych 初始化
// =============================================================================
const jsPsych = initJsPsych({
  display_element: "jspsych-target",
  on_finish: function () {
    try {
      jsPsych.data.get().localSave("json", `experiment_data_${subject_id}_${Date.now()}.json`);
    } catch (e) {
      console.error("保存数据失败：", e);
    }
    document.body.innerHTML = `
      <div style="width:100%; height:100%; background-color:#808080; display:flex; flex-direction:column; justify-content:center; align-items:center;">
        <h1 style="font-size:32px; margin-bottom:20px; color:white;">✅ 实验已完成！</h1>
        <p style="font-size:18px; margin:20px 0; color:white;">感谢您的参与！数据已自动保存，请您下载并发送给主试。</p>
      </div>`;
  }
});

// =============================================================================
// 资源
// =============================================================================
const stimuli = {
  face: ["img/face1.png", "img/face2.png"],
  house: ["img/house1.png", "img/house2.png"],
  digit: ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
};
const audio = { high: "audio/high_tone.wav", low: "audio/low_tone.wav" };

// =============================================================================
// 工具函数
// =============================================================================
const utils = {
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  pickCorner: () => ["top-left", "top-right", "bottom-left", "bottom-right"][Math.floor(Math.random() * 4)],
  getEmoji: (correct, miss) => miss ? "😐" : (correct ? "😊" : "😞"),
  isTwoBackMatch: (history, current) => history.length >= 2 && history[history.length - 2] === current
};

// =============================================================================
// 模板（指导语 / 练习结束页）
// =============================================================================
const templates = {
  instruction: (title, content, nextBtn = "下一页") => ({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div style="text-align:center; line-height:2.5; font-size:20px; max-width:700px; margin:0 auto; color:black; background:#f5f5f5; padding:30px; border-radius:12px;">
        <h2 style="text-align:center; margin-bottom:30px; font-size:24px;">TASK: ${title}</h2>
        <div style="text-align:left; font-size:17px; line-height:1.8;">
          ${content}
        </div>
      </div>`,
    choices: [nextBtn],
    button_html: '<button class="jspsych-btn">%choice%</button>'
  }),

  practiceEnd: (taskName, isLastRound) => {
    const keyReminder = taskName.includes("数字")
      ? `<p style="font-size:22px; line-height:1.8; color:white;">F = 不同<br>J = 相同</p>`
      : `<p style="font-size:22px; line-height:1.8; color:white;">F = 人脸<br>J = 房子</p>`;
    return {
      type: jsPsychHtmlButtonResponse,
      stimulus: `
        <div style="text-align:center; line-height:2.5; font-size:20px; max-width:700px; margin:0 auto; color:white;">
          <h2 style="font-size:28px; margin-bottom:20px;">${taskName} 练习结束</h2>
          ${isLastRound
            ? '<p style="font-size:18px;">练习已达到最大次数，准备进入下一阶段！</p>'
            : `<p style="font-size:18px;">是否已充分理解？</p>${keyReminder}
               <p style="font-size:16px; color:#ddd;">点击"继续"或"再练一次"</p>`}
        </div>`,
      choices: isLastRound ? ["继续"] : ["继续", "再练一次"],
      button_html: '<button class="jspsych-btn">%choice%</button>',
      on_finish: (data) => {
        repeat_practice = !isLastRound && data.response === 1;
        practice_round++;
      }
    };
  }
};

// =============================================================================
// 试次函数：图片预测（注视点 → 声音 → 反应 → 反馈）
// =============================================================================
function makeImageTrial(stimulus, tone, data_extra = {}) {
  const isFace = stimulus.includes("face");
  const correctKey = isFace ? CONFIG.keys.face : CONFIG.keys.house;

  return [
    {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: '<div class="fixation">+</div>',
      choices: "NO_KEYS",
      trial_duration: CONFIG.timings.fixation
    },
    {
      type: jsPsychAudioKeyboardResponse,
      stimulus: audio[tone],
      choices: "NO_KEYS",
      trial_ends_after_audio: true
    },
    {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: '<div class="fixation">+</div>',
      choices: ["f", "j"],
      response_ends_trial: true,
      trial_duration: CONFIG.timings.response,
      data: { event: "response", task: "image", tone, stimulus, isFace, correctKey, ...data_extra },
      on_finish: (data) => {
        data.correct = data.response === data.correctKey;
        data.miss = data.response === null;
      }
    },
    {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: function () {
        const last = jsPsych.data.get().last(1).values()[0];
        const emoji = utils.getEmoji(last?.correct, last?.miss);
        const corner = utils.pickCorner();
        return `
          <div class="feedback-wrapper">
            <div class="oval-container">
              <img src="${stimulus}" class="${isFace ? "stimulus-face" : "stimulus-house"}">
            </div>
            <div class="feedback-emoji ${corner}">${emoji}</div>
          </div>`;
      },
      choices: "NO_KEYS",
      trial_duration: CONFIG.timings.feedback
    }
  ];
}

// =============================================================================
// 试次函数：2-back
// =============================================================================
function makeNBackTrial(digit, data_extra = {}, withFeedback = false) {
  const isMatch = utils.isTwoBackMatch(nback_history, digit);

  const trials = [{
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div style="font-size:80px; font-weight:bold; color:white;">${digit}</div>`,
    choices: ["f", "j"],
    response_ends_trial: true,
    trial_duration: CONFIG.timings.response,
    data: { event: "response", task: "nback", digit, isMatch, ...data_extra },
    on_finish: (data) => {
      data.correct = (data.response === "j" && isMatch) || (data.response === "f" && !isMatch);
      data.miss = data.response === null;
    }
  }];

  if (withFeedback) {
    trials.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: function () {
        const last = jsPsych.data.get().last(1).values()[0];
        const text = last?.miss ? "未作答" : (last?.correct ? "正确" : "错误");
        return `<div style="font-size:48px; color:white; font-weight:bold;">${text}</div>`;
      },
      choices: "NO_KEYS",
      trial_duration: CONFIG.timings.feedback
    });
  }
  return trials;
}

// =============================================================================
// 构建 2-back 区块
// =============================================================================
function buildNBackBlock(numTrials = CONFIG.nback_trials, isPractice = false) {
  const block = [];
  nback_history = [];

  const seq = [utils.pick(stimuli.digit), utils.pick(stimuli.digit)];
  const numTargets = Math.floor((numTrials - 2) * CONFIG.nback_target_ratio);
  const available = Array.from({ length: numTrials - 2 }, (_, i) => i + 2);
  const targets = new Set();
  for (let i = 0; i < numTargets; i++) {
    targets.add(available.splice(Math.floor(Math.random() * available.length), 1)[0]);
  }
  for (let i = 2; i < numTrials; i++) {
    if (targets.has(i)) {
      seq[i] = seq[i - 2];
    } else {
      let d = utils.pick(stimuli.digit);
      while (d === seq[i - 2]) d = utils.pick(stimuli.digit);
      seq[i] = d;
    }
  }

  seq.forEach((digit, i) => {
    block.push(...makeNBackTrial(digit, {
      phase: isPractice ? "practice_nback" : "nback_formal",
      trialInPhase: i
    }, isPractice));
    nback_history.push(digit);
  });
  return block;
}

// =============================================================================
// 构建图片区块
// =============================================================================
function buildImageBlock(probs, segSize, phaseLabel) {
  const block = [];
  let idx = 0;
  probs.forEach((pHigh) => {
    for (let i = 0; i < segSize; i++, idx++) {
      const tone = Math.random() < 0.5 ? "high" : "low";
      const pHouse = tone === "high" ? pHigh : 1 - pHigh;
      const stim = utils.pick(Math.random() < pHouse ? stimuli.house : stimuli.face);
      block.push(...makeImageTrial(stim, tone, {
        phase: phaseLabel,
        trialInBlock: idx + 1
      }));
    }
  });
  return block;
}

// 练习用图片块（50/50，无概率结构）
function buildImagePractice(numTrials) {
  const block = [];
  const list = jsPsych.randomization.shuffle([
    ...Array(Math.floor(numTrials / 2)).fill(stimuli.face[0]),
    ...Array(Math.ceil(numTrials / 2)).fill(stimuli.house[0])
  ]);
  list.forEach((stim, i) => {
    const tone = Math.random() < 0.5 ? "high" : "low";
    block.push(...makeImageTrial(stim, tone, { phase: "practice_image", trialInPhase: i }));
  });
  return block;
}

// =============================================================================
// 指导语
// =============================================================================
const instructions = {
  overview: `
    <ol style="line-height:2.2; margin-left:20px; font-size:17px;">
      <li><b>学习阶段 1：数字判断任务指导语 + 练习</b></li>
      <li><b>学习阶段 2：图片预测任务指导语 + 练习</b></li>
      <li><b>正式实验顺序：数字任务 —— 图片任务 —— 数字任务 —— 图片任务</b></li>
    </ol>`,
  nback: `
    <p style="line-height:1.8;">你将看到一串一个接一个出现的数字。你的任务是判断：</p>
    <ul style="text-align:left; line-height:1.8;">
      <li>当前数字是否与<strong>往前数第2个数字</strong>相同；</li>
      <li>如果<strong>相同</strong>，请按"J"键；</li>
      <li>如果<strong>不同</strong>，请按"F"键；</li>
      <li>请尽量快速且准确地反应。</li>
    </ul>
    <p style="line-height:1.8;">例如：<strong>2、7、2、5</strong>……当第三个数字 <strong>2</strong> 出现时，它要和第一位数字 <strong>2</strong> 比较，2与2相同按J；当第四个数字 <strong>5</strong> 出现时，它要和第二位数字 <strong>7</strong> 比较，5与7不同按F。</p>`,
  image: `
    <p style="line-height:1.8;">你的任务是听到声音后，预测接下来出现的图片类型并按键：</p>
    <ul style="text-align:left; line-height:1.8;">
      <li>预测接下来的图片是房子，请按"J"键；</li>
      <li>预测接下来的图片是人脸，请按"F"键；</li>
      <li>请尽量快速且准确地反应。</li>
    </ul>
    <p><b>每个试次的步骤如下：</b></p>
    <ol style="line-height:2.1;">
      <li>屏幕中央先出现 <b>+</b>，请注视中央。</li>
      <li>你会听到一段声音。</li>
      <li>声音结束后，请尽快按键判断接下来会出现什么图片。</li>
      <li>图片出现时，会在四个角中的一个位置显示反馈表情。</li>
    </ol>
    <p>若答对，会反馈😊；若答错，会反馈😞；若无反应，会反馈😐。</p>`
};

// =============================================================================
// Timeline：开头
// =============================================================================
let timeline = [
  { type: jsPsychPreload, images: [...stimuli.face, ...stimuli.house], audio: [audio.high, audio.low] },
  {
    type: jsPsychSurveyHtmlForm,
    html: `
      <div style="text-align:center; max-width:500px; margin:0 auto; color:black;">
        <h2>个人信息</h2>
        <p style="text-align:left;">
          <label>被试编号：<input name="sub_id" type="text" required style="width:100%;"/></label><br/>
          <label>年龄：<input name="age" type="number" min="18" required style="width:100%;"/></label><br/>
          <label>性别：
            <select name="gender" required style="width:100%;">
              <option value="">请选择</option>
              <option value="男性">男性</option>
              <option value="女性">女性</option>
            </select>
          </label>
        </p>
      </div>`,
    button_label: "继续",
    on_finish: (data) => {
      const resp = data.response || {};
      subject_id = resp.sub_id || "unknown";
      jsPsych.data.addProperties({ sub_id: subject_id, age: resp.age || "", gender: resp.gender || "" });
    }
  },
  templates.instruction("实验流程总览", instructions.overview, "下一页")
];

// =============================================================================
// 练习块（带"再练一次"循环）
// =============================================================================
function addPracticeLoop(taskName, buildFunc, numRounds = 3) {
  timeline.push(templates.instruction(
    `${taskName}`,
    taskName.includes("数字判断任务") ? instructions.nback : instructions.image,
    "进入练习"
  ));
  for (let round = 1; round <= numRounds; round++) {
    timeline.push({
      timeline: [...buildFunc(), templates.practiceEnd(taskName, round === numRounds)],
      conditional_function: () => round === 1 || (repeat_practice && practice_round <= CONFIG.max_practice_rounds)
    });
  }
  timeline.push({
    type: jsPsychHtmlKeyboardResponse, stimulus: "", choices: "NO_KEYS", trial_duration: 0,
    on_start: () => { practice_round = 1; repeat_practice = false; }
  });
}

addPracticeLoop("数字判断任务", () => buildNBackBlock(CONFIG.nback_practice_trials, true), 3);
addPracticeLoop("图片预测任务", () => buildImagePractice(CONFIG.image_practice_trials), 3);

// =============================================================================
// 正式实验
// =============================================================================

// 正式实验开始提示
timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: `
    <div style="text-align:center; line-height:2.5; font-size:20px; max-width:700px; margin:0 auto; color:white;">
      <h2 style="font-size:28px; margin-bottom:30px;">准备开始正式实验</h2>
      <p style="font-size:18px; line-height:2;">你已完成所有练习！</p>
      <p style="font-size:18px; line-height:2;">即将开始正式实验</p>
      <p style="font-size:18px; line-height:2; margin-top:40px;">数字任务中：<b>F=不同，J=相同</b></p>
      <p style="font-size:18px; line-height:2;">图片任务中：<b>F=人脸，J=房子</b></p>
      <p style="font-size:18px; line-height:2; margin-top:40px;">保持注意力集中，按键快速准确</p>
      <p style="margin-top:50px; font-size:16px; color:#ddd;">按任意键继续</p>
    </div>`,
  choices: "ALL_KEYS"
});

// 第一段数字任务
timeline.push(...buildNBackBlock(CONFIG.nback_trials, false));

// 图片 Block 1：稳定，high→house = 0.8
timeline.push(...buildImageBlock([0.8], 80, "image_block1"));

// 图片 Block 2：每 20 次在 0.9/0.1 间反转
timeline.push(...buildImageBlock([0.9, 0.1, 0.9, 0.1], 20, "image_block2"));

// 中间休息 + 第二段数字任务
timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: `
    <div style="text-align:center; line-height:2.5; font-size:20px; max-width:700px; margin:0 auto; color:white;">
      <h2 style="font-size:32px; margin-bottom:50px;">☕ 中间休息</h2>
      <p style="font-size:20px; margin-bottom:40px;">稍作休息，准备继续</p>
      <p style="font-size:18px; margin:20px 0;"><b>提醒：</b></p>
      <p style="font-size:18px; margin:20px 0;">F键 = 人脸</p>
      <p style="font-size:18px; margin:20px 0;">J键 = 房子</p>
      <p style="margin-top:50px; font-size:16px; color:#ddd;">按任意键继续</p>
    </div>`,
  choices: "ALL_KEYS"
});

timeline.push(...buildNBackBlock(CONFIG.nback_trials, false));

// 图片 Block 3：稳定，high→house = 0.2
timeline.push(...buildImageBlock([0.2], 80, "image_block3"));

// 图片 Block 4：每 20 次在 0.9/0.1 间反转
timeline.push(...buildImageBlock([0.9, 0.1, 0.9, 0.1], 20, "image_block4"));

// =============================================================================
// 运行
// =============================================================================
jsPsych.run(timeline);
