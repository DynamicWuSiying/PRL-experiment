// =============================================================================
// 配置常量
// =============================================================================
const CONFIG = {
  timings: {
    fixation: 500,
    response: 2000,
    feedback: 700
  },
  keys: {
    match: "j",
    nonmatch: "f",
    house: "f",
    face: "j"
  },
  nback_trials: 16,
  image_trials_per_block: 80,
  nback_target_ratio: 0.3,
  max_practice_rounds: 3,
  styles: {
    centerBox: "text-align:center; line-height:2.5; font-size:20px; max-width:700px; margin:0 auto;",
    darkBox: "background:#555; padding:20px; border-radius:8px; font-size:17px;",
    infoBox: "background:#fff3cd; padding:15px; border-radius:8px; margin:15px 0; font-size:16px;",
    blockBox: "background:#f0f0f0; padding:20px; border-radius:8px; margin:15px 0;"
  }
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
      <div style="${CONFIG.styles.centerBox}; background-color:#808080; width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
        <h1 style="font-size:32px; margin-bottom:20px; color:white;">✅ 实验已完成！</h1>
        <p style="font-size:18px; margin:20px 0; color:white;">感谢你的参与！数据已自动保存。</p>
      </div>
    `;
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

const audio = {
  high: "audio/high_tone.wav",
  low: "audio/low_tone.wav"
};

const allStimuli = [...stimuli.face, ...stimuli.house];
const allAudio = [audio.high, audio.low];

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
// 模板
// =============================================================================
const templates = {
  instruction: (title, content, nextBtn = "下一页") => ({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div style="${CONFIG.styles.centerBox}; text-align:left; color:black; background:#f5f5f5; padding:30px; border-radius:12px; max-width:800px;">
        <h2 style="text-align:center; margin-bottom:30px;">${title}</h2>
        ${content}
      </div>
    `,
    choices: [nextBtn],
    button_html: '<button class="jspsych-btn">%choice%</button>'
  }),

  practiceEnd: (taskName, isLastRound) => ({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div style="${CONFIG.styles.centerBox}; color:white;">
        <h2>${taskName} 练习结束</h2>
        ${
          isLastRound
            ? '<p style="font-size:18px;">练习已达到最大次数，准备进入下一阶段！</p>'
            : '<p style="font-size:18px;">是否已充分理解？</p><p style="font-size:16px; color:#ddd;">点击"继续"或"再练一次"</p>'
        }
      </div>
    `,
    choices: isLastRound ? ["继续"] : ["继续", "再练一次"],
    button_html: '<button class="jspsych-btn">%choice%</button>',
    on_finish: (data) => {
      repeat_practice = !isLastRound && data.response === 1;
      practice_round++;
    }
  })
};

// =============================================================================
// 试次函数
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
      trial_ends_after_audio: true,
      trial_duration: 3000
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
          </div>
        `;
      },
      choices: "NO_KEYS",
      trial_duration: CONFIG.timings.feedback
    }
  ];
}

function makeNBackTrial(digit, data_extra = {}, withFeedback = false) {
  const isMatch = utils.isTwoBackMatch(nback_history, digit);

  const trials = [
    {
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
    }
  ];

  if (withFeedback) {
    trials.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: function () {
        const last = jsPsych.data.get().last(1).values()[0];
        const feedbackText = last?.miss ? "未作答" : (last?.correct ? "正确" : "错误");
        return `<div style="font-size:48px; color:white; font-weight:bold;">${feedbackText}</div>`;
      },
      choices: "NO_KEYS",
      trial_duration: CONFIG.timings.feedback
    });
  }

  return trials;
}

// =============================================================================
// 构建区块
// =============================================================================
function buildNBackBlock(blockNum, numTrials = CONFIG.nback_trials, isoPractice = false) {
  const block = [];
  nback_history = [];

  const targetRatio = CONFIG.nback_target_ratio;
  const digitSequence = [];
  const targetIndices = new Set();

  digitSequence.push(utils.pick(stimuli.digit));
  digitSequence.push(utils.pick(stimuli.digit));

  const numTargets = Math.floor((numTrials - 2) * targetRatio);
  const availableIndices = Array.from({ length: numTrials - 2 }, (_, i) => i + 2);

  for (let i = 0; i < numTargets; i++) {
    const idx = Math.floor(Math.random() * availableIndices.length);
    targetIndices.add(availableIndices.splice(idx, 1)[0]);
  }

  for (let i = 2; i < numTrials; i++) {
    if (targetIndices.has(i)) {
      digitSequence[i] = digitSequence[i - 2];
    } else {
      let digit = utils.pick(stimuli.digit);
      while (digit === digitSequence[i - 2]) {
        digit = utils.pick(stimuli.digit);
      }
      digitSequence[i] = digit;
    }
  }

  const withFeedback = isoPractice === true;

  for (let i = 0; i < numTrials; i++) {
    const digit = digitSequence[i];
    block.push(...makeNBackTrial(digit, {
      phase: isoPractice ? "practice_nback" : `nback_block${blockNum}`,
      trialInPhase: i,
      blockNum
    }, withFeedback));

    nback_history.push(digit);
  }

  return block;
}

function buildImageBlock(isoPractice = false, numTrials = 12) {
  const block = [];

  const faceCount = Math.floor(numTrials / 2);
  const houseCount = numTrials - faceCount;

  const stimList = jsPsych.randomization.shuffle([
    ...Array(faceCount).fill(stimuli.face[0]),
    ...Array(houseCount).fill(stimuli.house[0])
  ]);

  for (let i = 0; i < stimList.length; i++) {
    const tone = Math.random() < 0.5 ? "high" : "low";
    block.push(...makeImageTrial(stimList[i], tone, {
      phase: isoPractice ? "practice_image" : "image",
      trialInPhase: i
    }));
  }

  return block;
}

// =============================================================================
// 指导语
// =============================================================================
const instructions = {
  overview: `
    <ol style="line-height:2.2; margin-left:20px; font-size:17px; color:black;">
      <li><b>学习阶段 1：2-back任务指导语 + 练习</b></li>
      <li><b>学习阶段 2：图片任务指导语 + 练习</b></li>
      <li><b>正式实验顺序：2-back —— 图片任务 —— 2-back —— 图片任务</b></li>
    </ol>
  `,

  nback: `
    <p style="color:black;">判断当前数字是否与<b>往前数第2个数字</b>相同？</p>
    <div style="${CONFIG.styles.blockBox}">
      <p><b>按 J 键</b> → <b>相同</b></p>
      <p><b>按 F 键</b> → <b>不同</b></p>
    </div>
  `,

  image: `
    <p style="color:black;">听到声音后，预测接下来出现的图片类型</p>
    <div style="${CONFIG.styles.blockBox}">
      <p><b>按 F 键</b> → 预测 <b>房子</b></p>
      <p><b>按 J 键</b> → 预测 <b>人脸</b></p>
    </div>
  `
};

// =============================================================================
// Timeline
// =============================================================================
let timeline = [
  {
    type: jsPsychPreload,
    images: allStimuli,
    audio: allAudio
  },
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
              <option value="其他">其他</option>
            </select>
          </label>
        </p>
      </div>
    `,
    button_label: "继续",
    on_finish: (data) => {
      const resp = data.response || {};
      subject_id = resp.sub_id || "unknown";

      jsPsych.data.addProperties({
        sub_id: resp.sub_id || "unknown",
        age: resp.age || "",
        gender: resp.gender || ""
      });

      console.log("Survey response:", resp);
    }
  },
  templates.instruction("实验流程总览", instructions.overview, "下一页")
];

// =============================================================================
// 练习块
// =============================================================================
function addPracticeLoop(taskName, buildFunc, numRounds = 3) {
  timeline.push(
    templates.instruction(
      `任务：${taskName}`,
      taskName.includes("2-back") ? instructions.nback : instructions.image,
      "进入练习"
    )
  );

  for (let round = 1; round <= numRounds; round++) {
    timeline.push({
      timeline: [
        ...buildFunc(true),
        templates.practiceEnd(taskName, round === numRounds)
      ],
      conditional_function: () => round === 1 || (repeat_practice && practice_round <= CONFIG.max_practice_rounds)
    });
  }

  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: "",
    choices: "NO_KEYS",
    trial_duration: 0,
    on_start: () => {
      practice_round = 1;
      repeat_practice = false;
    }
  });
}

// 添加练习
addPracticeLoop("2-back 数字任务", () => buildNBackBlock(0, 12, true), 3);
addPracticeLoop("图片预测任务", () => buildImageBlock(true, 12), 3);

// =============================================================================
// 正式实验
// =============================================================================
timeline.push(
  templates.instruction(
    "正式实验",
    `<div style="${CONFIG.styles.darkBox}; color:white;">
      你已完成所有练习！<br/>
      即将开始正式实验<br/>
      保持注意力集中，按键快速准确
    </div>`,
    "开始实验"
  )
);

// 生成正式图片试次
const allTrials = [];
[0.8, 0.9, 0.2, 0.1].forEach((p) => {
  for (let i = 0; i < CONFIG.image_trials_per_block; i++) {
    const tone = Math.random() < 0.5 ? "high" : "low";
    const pHouse = tone === "high" ? p : 1 - p;
    const stim = utils.pick(Math.random() < pHouse ? stimuli.house : stimuli.face);
    allTrials.push({ stim, tone });
  }
});

// 分块
const blocks = [
  { name: "Block 1 (稳定)", trials: allTrials.slice(0, 80) },
  { name: "Block 2 (变化)", trials: allTrials.slice(80, 160) },
  { name: "Block 3 (稳定)", trials: allTrials.slice(160, 240) },
  { name: "Block 4 (变化)", trials: allTrials.slice(240) }
];

blocks.forEach((block, idx) => {
  if (idx === 0) {
    timeline.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div style="${CONFIG.styles.centerBox}; color:white;">正式任务插入：<b>16 试次 2-back</b><br/>按任意键开始</div>`,
      choices: "ALL_KEYS"
    });
    timeline.push(...buildNBackBlock(1, 16, false));
  }

  // 直接插入图片区块试次，不再使用 blockStart
  block.trials.forEach((trial) => {
    timeline.push(...makeImageTrial(trial.stim, trial.tone, {
      phase: `block${idx + 1}`,
      blockNum: idx + 1
    }));
  });

  if (idx === 2) {
    timeline.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div style="${CONFIG.styles.centerBox}; color:white;">☕ 中间休息<br/>接下来 16 个数字任务<br/>按任意键继续</div>`,
      choices: "ALL_KEYS"
    });
    timeline.push(...buildNBackBlock(2, 16, false));
  }
});

// =============================================================================
// 运行
// =============================================================================
console.log("Timeline length:", timeline.length);
jsPsych.run(timeline);
