/* ===========================================================================
   概率性线索—结果学习实验（jsPsych）
   ---------------------------------------------------------------------------
   阅读顺序（代码就是按这个顺序组织的）：

     ① CONFIG ................ 所有可调参数：时长、按键、试次数、重复轮数
     ② 状态变量 + 伪随机 ..... subject_id / 轮次计数 / 两条独立随机流
     ③ jsPsych 初始化 ........ 数据保存与结束页
     ④ 刺激材料 .............. 人脸、房屋图片、数字、两个音频
     ⑤ 显示工厂 .............. htmlTrial / audioTrial / buttonTrial 三个试次模板
     ⑥ 指导语与结束页 ........ 各阶段的说明文字、可重复阶段的结束页
     ⑦ 试次构造 .............. makeImageTrial / makeNBackTrial（单个试次内部拆成几屏）
     ⑧ 组块构造 .............. buildNBackBlock / buildSoundFamiliarization /
                               buildImageBlock / buildImagePractice（一批试次）
     ⑨ 时间线组装 ............ addRepeatableBlock 把阶段串起来，最后 jsPsych.run

   核心概念：jsPsych 的「试次(trial)」= 屏幕上的一屏。一个实验任务的一道题，
   往往由好几屏组成（注视点 → 刺激 → 反馈 → 间隔），所以下面 ⑦ 的函数都返回
   一个数组而非单个对象。
   =========================================================================== */

/* ------------------------------ ① 配置 ------------------------------ */
const CONFIG = {
  nback_timings: { fixation: 300, response: 2000, feedback: 500 },
  // 仅用于声音熟悉阶段：sound = 每个音的呈现时长，interval = 音与音之间的空屏
  sound_timings: { sound: 300, interval: 500 },
  image_timings: {
    cue: 300, response: 2000, target: 300,
    practice_feedback: 500, iti_min: 1000, iti_max: 1500
  },
  keys: { match: "j", nonmatch: "f", house: "j", face: "f" },
  nback_trials: 32,
  nback_practice_trials: 10,
  image_practice_trials: 12,
  nback_target_ratio: 0.3,
  max_practice_rounds: 3
};

let subject_id = "unknown";
let practice_round = 1;
let repeat_practice = false;
let nback_history = [];

/* ---------------------- ② 状态变量 + 伪随机 ---------------------- */
const PRNG_SEED = 20261010;
let prng_state = PRNG_SEED >>> 0;

function random01() {
  prng_state = (1664525 * prng_state + 1013904223) >>> 0;
  return prng_state / 4294967296;
}

// 声音熟悉专用随机流（由主种子派生）：增减声音轮次不会打乱后续正式试次的抽样序列
let sound_prng_state = (PRNG_SEED ^ 0x5bf03635) >>> 0;

function soundRandom01() {
  sound_prng_state = (1664525 * sound_prng_state + 1013904223) >>> 0;
  return sound_prng_state / 4294967296;
}

const pick = (arr) => arr[Math.floor(random01() * arr.length)];

const isTwoBackMatch = (history, cur) =>
  history.length >= 2 && history[history.length - 2] === cur;

/* ------------------------ ③ jsPsych 初始化 ------------------------ */
const jsPsych = initJsPsych({
  display_element: "jspsych-target",

  on_finish: function () {
    try {
      jsPsych.data.get().localSave(
        "csv",
        `experiment_data_${subject_id}_${Date.now()}.csv`
      );
    } catch (error) {
      console.error("保存数据失败：", error);
    }

    document.body.innerHTML = `
      <div style="width:100%; height:100%; background:#808080; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white;">
        <h1>实验已完成！</h1>
        <p>感谢您的参与！请确认数据已经下载并发送给主试。</p>
      </div>
    `;
  }
});

/* -------------------------- ④ 刺激材料 -------------------------- */
const stimuli = {
  face: ["img/face1.png", "img/face2.png"],
  house: ["img/house1.png", "img/house2.png"],
  digit: ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
};

const audio = {
  high: "audio/high_tone.wav",
  low: "audio/low_tone.wav"
};

/* ------------------------ ⑤ 显示片段与试次工厂 ------------------------ */
const FIXATION = '<div class="fixation">+</div>';
const NO_KEYS = "NO_KEYS";
const BUTTON_HTML = '<button class="jspsych-btn">%choice%</button>';

// 居中卡片（白字，用于练习结束 / 阶段过渡 / 休息）
const whiteCard = (inner, lineHeight = 2.5) => `
  <div style="text-align:center; line-height:${lineHeight}; max-width:700px; margin:0 auto; color:white;">
    ${inner}
  </div>`;

// 指导语卡片（深底浅字 + 浅灰背景块）
const instructionCard = (title, content) => `
  <div style="text-align:center; line-height:2; max-width:700px; margin:0 auto; color:black; background:#f5f5f5; padding:30px; border-radius:12px;">
    <h2>${title}</h2>
    <div style="text-align:left; font-size:17px; line-height:1.8;">${content}</div>
  </div>`;

// 反馈页大字号文字：未作答/无反应 → 正确 → 错误
const feedbackStimulus = (miss, correct, missLabel) => {
  const text = miss ? missLabel : correct ? "正确" : "错误";
  return `<div style="font-size:48px; color:white; font-weight:bold;">${text}</div>`;
};

// 轮次标记：多轮阶段靠它区分同一 trialInPhase 属于第几轮；单轮阶段不写该字段
const withRound = (round) => (round == null ? {} : { round });

// html-keyboard-response 工厂
const htmlTrial = ({
  stimulus,
  choices = NO_KEYS,
  duration = null,
  responseEnds,      // 不传则沿用插件默认
  data,
  onStart,
  onFinish
}) => ({
  type: jsPsychHtmlKeyboardResponse,
  stimulus,
  choices,
  trial_duration: duration,
  ...(responseEnds !== undefined && { response_ends_trial: responseEnds }),
  ...(data !== undefined && { data }),
  ...(onStart !== undefined && { on_start: onStart }),
  ...(onFinish !== undefined && { on_finish: onFinish })
});

// audio-keyboard-response 工厂（只放声音，注视点作为 prompt）
const audioTrial = ({ tone, duration, data }) => ({
  type: jsPsychAudioKeyboardResponse,
  stimulus: audio[tone],
  prompt: FIXATION,
  choices: NO_KEYS,
  trial_duration: duration,
  trial_ends_after_audio: false,
  response_ends_trial: false,
  data
});

// 按钮页工厂
const buttonTrial = ({ stimulus, choices, data, onFinish }) => ({
  type: jsPsychHtmlButtonResponse,
  stimulus,
  choices,
  button_html: BUTTON_HTML,
  data,
  on_finish: onFinish
});

/* ----------------------- ⑥ 指导语与阶段结束页 ----------------------- */
const INSTRUCTIONS = {
  overview: `<ol style="line-height:2.2;"><li>完成数字判断任务练习。</li><li>熟悉实验中会出现的两种声音。</li><li>完成图片预测任务练习。</li><li>进入正式实验。</li></ol>`,

  nback: `
    <p>请按照屏幕提示完成数字判断任务。 屏幕上会依次出现数字，请判断当前数字是否与往前数第 2 个数字相同。</p>
    <ul><li>相同：按 <b>J</b>。</li><li>不同：按 <b>F</b>。</li><li>请保持注意力集中，并尽量快速、准确地按键。</li></ul>
    <p>例如：2、7、2、5。 第三个数字 2 与第一个数字 2 相同，按 J； 第四个数字 5 与第二个数字 7 不同，按 F。</p>`,

  image: `
    <p>请按照屏幕提示完成图片预测任务。 每次会先听到一个声音，请根据声音预测接下来会出现的人脸或房屋。</p>
    <ul><li>预测人脸：按 <b>F</b>。</li><li>预测房屋：按 <b>J</b>。</li><li>请保持注意力集中，并尽量快速、准确地按键。</li></ul>
    <p>声音结束后，请在中央注视点出现时进行预测。 按键后会呈现真实图片；如果没有按键，也会呈现真实图片。</p>
    <p>练习时会显示“正确”“错误”或“无反应”。 正式任务中不显示这些文字反馈。</p>`,

  sound: `
    <p>接下来会听到两种不同的声音。</p>
    <p>请按照屏幕上的说明完成任务， 保持注意力集中，眼睛注视屏幕中央的“＋”，认真聆听声音。</p>
    <p><b>这一阶段不需要判断声音类型，也不要按键。</b></p>
    <p>声音全部播放结束后， 如果能够听出这是两种不同的声音， 请点击确认按钮。</p>`
};

const instructionScreen = (title, content, nextBtn = "下一页") =>
  buttonTrial({
    stimulus: instructionCard(title, content),
    choices: [nextBtn]
  });

// 可重复阶段的结束页：末轮只给确认键；非末轮多给一个“再来一次”，
// 点它 → repeat_practice = true + practice_round++ → 触发下一轮（见 addRepeatableBlock）
const repeatEndScreen = ({ title, body, confirm, repeat, lineHeight = 2.5, data }) =>
  (isLastRound) =>
    buttonTrial({
      stimulus: whiteCard(`<h2>${title}</h2>${body(isLastRound)}`, lineHeight),
      choices: isLastRound ? [confirm] : [confirm, repeat],
      ...(data !== undefined && { data }),
      onFinish: (d) => {
        repeat_practice = !isLastRound && d.response === 1;
        practice_round++;
      }
    });

// 数字 / 图片练习的结束页
const PRACTICE_END = (taskName) =>
  repeatEndScreen({
    title: `${taskName}练习结束`,
    confirm: "继续",
    repeat: "再练一次",
    body: (isLast) =>
      isLast
        ? "<p>练习已完成，准备进入下一阶段。</p>"
        : `<p>是否需要再练习一次？</p>
           <p style="font-size:22px;">${
             taskName.includes("数字") ? "F = 不同<br>J = 相同" : "F = 人脸<br>J = 房屋"
           }</p>
           <p>点击“继续”或“再练一次”。</p>`
  });

// 声音熟悉的结束页：确认听辨结果 +（非末轮）可再听一轮
const SOUND_END = repeatEndScreen({
  title: "声音熟悉完成",
  confirm: "我能听出两种不同的声音",
  repeat: "再听一次",
  lineHeight: 2,
  data: {
    task: "sound_familiarization",
    phase: "sound_familiarization",
    event: "confirmation"
  },
  body: (isLast) =>
    `<p>如果你能够听出刚才是两种不同的声音， 请点击下面的按钮。</p>` +
    (isLast ? "" : "<p>如果还不确定，可以再听一轮。</p>")
});

/* --------------------- ⑦ 试次构造：图片预测任务 --------------------- */
function makeImageTrial(stimulus, tone, extra = {}) {
  const T = CONFIG.image_timings;
  const isFace = stimulus.includes("face");
  const correctKey = isFace ? CONFIG.keys.face : CONFIG.keys.house;
  const isPractice = extra.phase === "practice_image";
  const base = { task: "image", tone, stimulus, isFace, correctKey, ...extra };

  let itiMs;
  let result = { correct: false, miss: true };

  const trials = [
    // 1) 声音线索
    audioTrial({
      tone,
      duration: T.cue,
      data: { ...base, event: "cue", planned_duration_ms: T.cue }
    }),

    // 2) 预测按键
    htmlTrial({
      stimulus: FIXATION,
      choices: [CONFIG.keys.face, CONFIG.keys.house],
      duration: T.response,
      responseEnds: true,
      data: { ...base, event: "response" },
      onFinish: (data) => {
        data.correct = data.response === data.correctKey;
        data.miss = data.response === null;
        result = { correct: data.correct, miss: data.miss };
      }
    }),

    // 3) 真实图片
    htmlTrial({
      stimulus: `<div class="oval-container"><img src="${stimulus}" alt="" class="${isFace ? "stimulus-face" : "stimulus-house"}"></div>`,
      duration: T.target,
      data: { ...base, event: "outcome", planned_duration_ms: T.target }
    })
  ];

  // 4) 练习反馈（仅练习阶段）
  if (isPractice) {
    trials.push(
      htmlTrial({
        stimulus: () => feedbackStimulus(result.miss, result.correct, "无反应"),
        duration: T.practice_feedback,
        data: { ...base, event: "practice_feedback" },
        onFinish: (data) => {
          data.correct = result.correct;
          data.miss = result.miss;
        }
      })
    );
  }

  // 5) ITI
  trials.push(
    htmlTrial({
      stimulus: FIXATION,
      duration: () => {
        itiMs = T.iti_min + Math.floor(random01() * (T.iti_max - T.iti_min + 1));
        return itiMs;
      },
      data: { ...base, event: "iti" },
      onFinish: (data) => { data.planned_duration_ms = itiMs; }
    })
  );

  return trials;
}

/* --------------------- ⑦ 试次构造：数字 n-back --------------------- */
function makeNBackTrial(digit, extra = {}, withFeedback = false) {
  const T = CONFIG.nback_timings;
  const isMatch = isTwoBackMatch(nback_history, digit);

  const trials = [
    htmlTrial({
      stimulus: FIXATION,
      duration: T.fixation,
      data: { ...extra, task: "nback", event: "fixation", planned_duration_ms: T.fixation }
    }),

    htmlTrial({
      stimulus: `<div style="font-size:80px; font-weight:bold; color:white;">${digit}</div>`,
      choices: [CONFIG.keys.nonmatch, CONFIG.keys.match],
      duration: T.response,
      responseEnds: true,
      data: { event: "response", task: "nback", digit, isMatch, ...extra },
      onFinish: (data) => {
        data.correct =
          (data.response === CONFIG.keys.match && isMatch) ||
          (data.response === CONFIG.keys.nonmatch && !isMatch);
        data.miss = data.response === null;
      }
    })
  ];

  if (withFeedback) {
    trials.push(
      htmlTrial({
        stimulus: () => {
          const last = jsPsych.data.get().last(1).values()[0];
          return feedbackStimulus(last.miss, last.correct, "未作答");
        },
        duration: T.feedback,
        data: {
          task: "nback",
          event: "feedback",
          planned_duration_ms: T.feedback,
          ...withRound(extra.round)
        }
      })
    );
  }

  return trials;
}

/* --------------------------- ⑧ 组块构造 --------------------------- */
function buildNBackBlock(numTrials = CONFIG.nback_trials, isPractice = false, round = null) {
  const block = [];
  nback_history = [];

  const seq = [pick(stimuli.digit), pick(stimuli.digit)];

  // 随机挑选 target 位置（2-back 匹配位）
  const numTargets = Math.floor((numTrials - 2) * CONFIG.nback_target_ratio);
  const available = Array.from({ length: numTrials - 2 }, (_, i) => i + 2);
  const targets = new Set();
  for (let i = 0; i < numTargets; i++) {
    targets.add(available.splice(Math.floor(random01() * available.length), 1)[0]);
  }

  for (let i = 2; i < numTrials; i++) {
    if (targets.has(i)) {
      seq[i] = seq[i - 2];
    } else {
      let digit = pick(stimuli.digit);
      while (digit === seq[i - 2]) digit = pick(stimuli.digit);
      seq[i] = digit;
    }
  }

  seq.forEach((digit, index) => {
    block.push(
      ...makeNBackTrial(
        digit,
        {
          phase: isPractice ? "practice_nback" : "nback_formal",
          trialInPhase: index + 1,
          ...withRound(round)
        },
        isPractice
      )
    );
    nback_history.push(digit);
  });

  return block;
}

function buildSoundFamiliarization(round = null) {
  const tones = [...Array(10).fill("high"), ...Array(10).fill("low")];

  for (let i = tones.length - 1; i > 0; i--) {
    const j = Math.floor(soundRandom01() * (i + 1));
    [tones[i], tones[j]] = [tones[j], tones[i]];
  }

  const block = [];

  tones.forEach((tone, index) => {
    const base = {
      task: "sound_familiarization",
      phase: "sound_familiarization",
      tone,
      trialInPhase: index + 1,
      ...withRound(round)
    };

    block.push(
      audioTrial({
        tone,
        duration: CONFIG.sound_timings.sound,
        data: { ...base, event: "sound", planned_duration_ms: CONFIG.sound_timings.sound }
      })
    );

    block.push(
      htmlTrial({
        stimulus: FIXATION,
        duration: CONFIG.sound_timings.interval,
        responseEnds: false,
        data: { ...base, event: "interval", planned_duration_ms: CONFIG.sound_timings.interval }
      })
    );
  });

  return block;
}

function buildImageBlock(probs, segSize, phaseLabel) {
  const block = [];
  let index = 0;

  probs.forEach((pHigh) => {
    for (let i = 0; i < segSize; i++, index++) {
      const tone = random01() < 0.5 ? "high" : "low";
      const pHouse = tone === "high" ? pHigh : 1 - pHigh;
      const category = random01() < pHouse ? stimuli.house : stimuli.face;
      const stimulus = pick(category);

      block.push(
        ...makeImageTrial(stimulus, tone, {
          phase: phaseLabel,
          trialInBlock: index + 1,
          probability_high_house: pHigh
        })
      );
    }
  });

  return block;
}

function buildImagePractice(numTrials, round = null) {
  const block = [];

  const list = jsPsych.randomization.shuffle([
    ...Array(Math.floor(numTrials / 2)).fill(stimuli.face[0]),
    ...Array(Math.ceil(numTrials / 2)).fill(stimuli.house[0])
  ]);

  list.forEach((stimulus, index) => {
    const tone = random01() < 0.5 ? "high" : "low";

    block.push(
      ...makeImageTrial(stimulus, tone, {
        phase: "practice_image",
        trialInPhase: index + 1,
        probability_high_house: null,
        ...withRound(round)
      })
    );
  });

  return block;
}

/* --------------------------- ⑨ 时间线组装 --------------------------- */
const timeline = [
  {
    type: jsPsychPreload,
    images: [...stimuli.face, ...stimuli.house],
    audio: [audio.high, audio.low]
  },

  {
    type: jsPsychSurveyHtmlForm,

    html: `
      <div style="text-align:center; max-width:500px; margin:0 auto; color:black;">
        <h2>个人信息</h2>
        <p style="text-align:left;"><label>被试编号：<input name="sub_id" type="text" required style="width:100%;"></label></p>
        <p style="text-align:left;"><label>年龄：<input name="age" type="number" min="18" required style="width:100%;"></label></p>
        <p style="text-align:left;"><label>性别：
          <select name="gender" required style="width:100%;">
            <option value="">请选择</option>
            <option value="男性">男性</option>
            <option value="女性">女性</option>
          </select>
        </label></p>
      </div>`,

    button_label: "继续",

    on_finish: (data) => {
      const response = data.response || {};
      subject_id = response.sub_id || "unknown";
      jsPsych.data.addProperties({
        sub_id: subject_id,
        age: response.age || "",
        gender: response.gender || ""
      });
    }
  },

  instructionScreen("实验流程总览", INSTRUCTIONS.overview, "下一页")
];

// 可重复阶段：指导语 → 最多 numRounds 轮（每轮结束页可再重复一次）→ 复位计数
// endScreen(isLastRound) 由各阶段自定义，因此练习任务与声音熟悉可共用同一套循环逻辑
function addRepeatableBlock({
  title,
  instruction,
  buildFunc,
  endScreen,
  nextBtn = "进入练习",
  numRounds = CONFIG.max_practice_rounds
}) {
  timeline.push(instructionScreen(title, instruction, nextBtn));

  for (let round = 1; round <= numRounds; round++) {
    timeline.push({
      timeline: [...buildFunc(round), endScreen(round === numRounds)],
      conditional_function: () =>
        round === 1 ||
        (repeat_practice && practice_round <= CONFIG.max_practice_rounds)
    });
  }

  // 复位计数，避免影响下一个阶段的循环
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: "",
    choices: NO_KEYS,
    trial_duration: 0,
    on_start: () => {
      practice_round = 1;
      repeat_practice = false;
    }
  });
}

/* 1. 数字判断任务练习（最多 3 轮） */
addRepeatableBlock({
  title: "数字判断任务",
  instruction: INSTRUCTIONS.nback,
  nextBtn: "进入练习",
  buildFunc: (round) => buildNBackBlock(CONFIG.nback_practice_trials, true, round),
  endScreen: PRACTICE_END("数字判断任务")
});

/* 2. 声音熟悉（最多 3 轮，每轮结束可再听一次） */
addRepeatableBlock({
  title: "声音熟悉阶段",
  instruction: INSTRUCTIONS.sound,
  nextBtn: "开始声音熟悉",
  buildFunc: (round) => buildSoundFamiliarization(round),
  endScreen: SOUND_END
});

/* 3. 图片预测任务练习（最多 3 轮） */
addRepeatableBlock({
  title: "图片预测任务",
  instruction: INSTRUCTIONS.image,
  nextBtn: "进入练习",
  buildFunc: (round) => buildImagePractice(CONFIG.image_practice_trials, round),
  endScreen: PRACTICE_END("图片预测任务")
});

/* 4. 正式实验 */
timeline.push(
  htmlTrial({
    stimulus: whiteCard(`
      <h2>准备开始正式实验</h2>
      <p>你已完成所有练习。</p>
      <p>接下来先完成数字任务，再完成图片任务。</p>
      <p>数字任务：<b>F = 不同，J = 相同</b></p>
      <p>图片任务：<b>F = 人脸，J = 房屋</b></p>
      <p>请按照屏幕提示完成任务，保持注意力集中。</p>
      <p style="margin-top:40px;">按任意键继续</p>`),
    choices: "ALL_KEYS"
  })
);

timeline.push(...buildNBackBlock(CONFIG.nback_trials, false));
timeline.push(...buildImageBlock([0.8], 80, "image_block1"));
timeline.push(...buildImageBlock([0.1, 0.9, 0.1, 0.9], 20, "image_block2"));

timeline.push(
  htmlTrial({
    stimulus: whiteCard(`
      <h2>中间休息</h2>
      <p>请稍作休息，准备继续图片任务。</p>
      <p><b>F = 人脸；J = 房屋</b></p>
      <p style="margin-top:40px;">准备好后按任意键继续</p>`),
    choices: "ALL_KEYS"
  })
);

timeline.push(...buildImageBlock([0.2], 80, "image_block3"));
timeline.push(...buildImageBlock([0.9, 0.1, 0.9, 0.1], 20, "image_block4"));

jsPsych.run(timeline);
