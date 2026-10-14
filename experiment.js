// =============================================================================
// 配置：数字任务与图片任务分别设置时间
// =============================================================================

const CONFIG = {
  nback_timings: {
    fixation: 300,
    response: 2000,
    feedback: 500
  },

  image_timings: {
    cue: 300,
    response: 3000,
    target: 300,

    // 新增：图片练习文字反馈时间
    practice_feedback: 500,

    iti_min: 1500,
    iti_max: 2500
  },

  keys: {
    match: "j",
    nonmatch: "f",
    house: "j",
    face: "f"
  },

  nback_trials: 32,
  nback_practice_trials: 10,
  image_practice_trials: 12,

  nback_target_ratio: 0.3,
  max_practice_rounds: 3
};

// =============================================================================
// 全局变量与随机数
// =============================================================================

let subject_id = "unknown";
let practice_round = 1;
let repeat_practice = false;
let nback_history = [];

const PRNG_SEED = 20261010;
let prng_state = PRNG_SEED >>> 0;

function random01() {
  prng_state = (1664525 * prng_state + 1013904223) >>> 0;
  return prng_state / 4294967296;
}

// =============================================================================
// jsPsych 初始化
// =============================================================================

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
      <div style="
        width:100%;
        height:100%;
        background-color:#808080;
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        color:white;
      ">
        <h1 style="font-size:32px;margin-bottom:20px;">
          实验已完成！
        </h1>
        <p style="font-size:18px;margin:20px 0;">
          感谢您的参与！请确认实验数据已经下载，并发送给主试。
        </p>
      </div>
    `;
  }
});

// =============================================================================
// 素材：两张面孔、两张房屋
// =============================================================================

const stimuli = {
  face: [
    "img/face1.png",
    "img/face2.png"
  ],

  house: [
    "img/house1.png",
    "img/house2.png"
  ],

  digit: [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9"
  ]
};

const audio = {
  high: "audio/high_tone.wav",
  low: "audio/low_tone.wav"
};

// =============================================================================
// 工具函数
// =============================================================================

const utils = {
  pick: (array) => {
    return array[Math.floor(random01() * array.length)];
  },

  isTwoBackMatch: (history, current) => {
    return (
      history.length >= 2 &&
      history[history.length - 2] === current
    );
  }
};

// =============================================================================
// 指导语与练习结束页模板
// =============================================================================

const templates = {
  instruction: (title, content, nextBtn = "下一页") => ({
    type: jsPsychHtmlButtonResponse,

    stimulus: `
      <div style="
        text-align:center;
        line-height:2;
        max-width:700px;
        margin:0 auto;
        color:black;
        background:#f5f5f5;
        padding:30px;
        border-radius:12px;
      ">
        <h2 style="margin-bottom:25px;font-size:24px;">
          ${title}
        </h2>
        <div style="text-align:left;font-size:17px;line-height:1.8;">
          ${content}
        </div>
      </div>
    `,

    choices: [nextBtn],
    button_html: '<button class="jspsych-btn">%choice%</button>'
  }),

  practiceEnd: (taskName, isLastRound) => {
    const keyReminder = taskName.includes("数字")
      ? `
        <p style="font-size:22px;line-height:1.8;">
          F = 不同<br>
          J = 相同
        </p>
      `
      : `
        <p style="font-size:22px;line-height:1.8;">
          F = 人脸<br>
          J = 房子
        </p>
      `;

    return {
      type: jsPsychHtmlButtonResponse,

      stimulus: `
        <div style="
          text-align:center;
          line-height:2.5;
          max-width:700px;
          margin:0 auto;
          color:white;
        ">
          <h2 style="font-size:28px;margin-bottom:20px;">
            ${taskName}练习结束
          </h2>

          ${
            isLastRound
              ? `
                <p style="font-size:18px;">
                  练习已达到最大次数，准备进入下一阶段。
                </p>
              `
              : `
                <p style="font-size:18px;">
                  是否已充分理解任务？
                </p>
                ${keyReminder}
                <p style="font-size:16px;">
                  点击“继续”或“再练一次”。
                </p>
              `
          }
        </div>
      `,

      choices: isLastRound
        ? ["继续"]
        : ["继续", "再练一次"],

      button_html: '<button class="jspsych-btn">%choice%</button>',

      on_finish: (data) => {
        repeat_practice = !isLastRound && data.response === 1;
        practice_round++;
      }
    };
  }
};

// =============================================================================
// 图片任务单试次
//
// 正式：声音 → 预测 → 真实图片 → 随机间隔
// 练习：声音 → 预测 → 真实图片 → 文字反馈 → 随机间隔
// =============================================================================

function makeImageTrial(stimulus, tone, data_extra = {}) {
  const isFace = stimulus.includes("face");

  const correctKey = isFace
    ? CONFIG.keys.face
    : CONFIG.keys.house;

  const isPractice = data_extra.phase === "practice_image";

  let itiMs;

  // 保存本试次的预测结果，供真实图片之后的练习反馈使用。
  // 不直接读取上一行数据，因为上一行此时是图片呈现记录。
  let responseResult = {
    correct: false,
    miss: true
  };

  const trialData = {
    task: "image",
    tone,
    stimulus,
    isFace,
    correctKey,
    ...data_extra
  };

  const trials = [
    // -------------------------------------------------------------------------
    // 1. 声音线索：300 毫秒，不接受按键
    // -------------------------------------------------------------------------
    {
      type: jsPsychAudioKeyboardResponse,
      stimulus: audio[tone],
      prompt: '<div class="fixation">+</div>',

      choices: "NO_KEYS",
      trial_duration: CONFIG.image_timings.cue,
      trial_ends_after_audio: false,
      response_ends_trial: false,

      data: {
        ...trialData,
        event: "cue",
        planned_duration_ms: CONFIG.image_timings.cue
      }
    },

    // -------------------------------------------------------------------------
    // 2. 预测反应：有效按键立即结束，最长 3000 毫秒
    // -------------------------------------------------------------------------
    {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: '<div class="fixation">+</div>',

      choices: [
        CONFIG.keys.face,
        CONFIG.keys.house
      ],

      trial_duration: CONFIG.image_timings.response,
      response_ends_trial: true,

      data: {
        ...trialData,
        event: "response"
      },

      on_finish: (data) => {
        data.correct = data.response === data.correctKey;
        data.miss = data.response === null;

        responseResult = {
          correct: data.correct,
          miss: data.miss
        };
      }
    },

    // -------------------------------------------------------------------------
    // 3. 真实图片：固定 300 毫秒
    // 即使预测超时，也照常呈现。
    // -------------------------------------------------------------------------
    {
      type: jsPsychHtmlKeyboardResponse,

      stimulus: `
        <div class="oval-container">
          <img
            src="${stimulus}"
            alt=""
            style="
              width:100%;
              height:100%;
              object-fit:cover;
            "
          >
        </div>
      `,

      choices: "NO_KEYS",
      trial_duration: CONFIG.image_timings.target,

      data: {
        ...trialData,
        event: "outcome",
        planned_duration_ms: CONFIG.image_timings.target
      }
    }
  ];

  // ---------------------------------------------------------------------------
  // 4. 新增：只有图片练习显示文字反馈，固定 500 毫秒
  // ---------------------------------------------------------------------------
  if (isPractice) {
    trials.push({
      type: jsPsychHtmlKeyboardResponse,

      stimulus: () => {
        const text = responseResult.miss
          ? "无反应"
          : (responseResult.correct ? "正确" : "错误");

        return `
          <div style="
            font-size:48px;
            color:white;
            font-weight:bold;
          ">
            ${text}
          </div>
        `;
      },

      choices: "NO_KEYS",
      trial_duration: CONFIG.image_timings.practice_feedback,

      data: {
        ...trialData,
        event: "practice_feedback"
      },

      on_finish: (data) => {
        data.correct = responseResult.correct;
        data.miss = responseResult.miss;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 5. 随机试次间隔：1500–2500 毫秒
  // 执行时抽取时长，避免改变预先生成的刺激序列。
  // ---------------------------------------------------------------------------
  trials.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div class="fixation">+</div>',
    choices: "NO_KEYS",

    trial_duration: () => {
      itiMs = CONFIG.image_timings.iti_min + Math.floor(
        random01() * (
          CONFIG.image_timings.iti_max -
          CONFIG.image_timings.iti_min +
          1
        )
      );

      return itiMs;
    },

    data: {
      ...trialData,
      event: "iti"
    },

    on_finish: (data) => {
      data.planned_duration_ms = itiMs;
    }
  });

  return trials;
}

// =============================================================================
// 数字任务单试次
// 注视 300 毫秒 → 数字反应最长 2000 毫秒 → 练习反馈 500 毫秒
// =============================================================================

function makeNBackTrial(
  digit,
  data_extra = {},
  withFeedback = false
) {
  const isMatch = utils.isTwoBackMatch(nback_history, digit);

  const trials = [
    {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: '<div class="fixation">+</div>',
      choices: "NO_KEYS",
      trial_duration: CONFIG.nback_timings.fixation,

      data: {
        ...data_extra,
        task: "nback",
        event: "fixation"
      }
    },

    {
      type: jsPsychHtmlKeyboardResponse,

      stimulus: `
        <div style="
          font-size:80px;
          font-weight:bold;
          color:white;
        ">
          ${digit}
        </div>
      `,

      choices: [
        CONFIG.keys.nonmatch,
        CONFIG.keys.match
      ],

      response_ends_trial: true,
      trial_duration: CONFIG.nback_timings.response,

      data: {
        event: "response",
        task: "nback",
        digit,
        isMatch,
        ...data_extra
      },

      on_finish: (data) => {
        data.correct = (
          (data.response === CONFIG.keys.match && isMatch) ||
          (data.response === CONFIG.keys.nonmatch && !isMatch)
        );

        data.miss = data.response === null;
      }
    }
  ];

  if (withFeedback) {
    trials.push({
      type: jsPsychHtmlKeyboardResponse,

      stimulus: () => {
        const last = jsPsych.data.get().last(1).values()[0];

        const text = last?.miss
          ? "未作答"
          : (last?.correct ? "正确" : "错误");

        return `
          <div style="
            font-size:48px;
            color:white;
            font-weight:bold;
          ">
            ${text}
          </div>
        `;
      },

      choices: "NO_KEYS",
      trial_duration: CONFIG.nback_timings.feedback
    });
  }

  return trials;
}

// =============================================================================
// 生成 2-back 区块
// =============================================================================

function buildNBackBlock(
  numTrials = CONFIG.nback_trials,
  isPractice = false
) {
  const block = [];
  nback_history = [];

  const seq = [
    utils.pick(stimuli.digit),
    utils.pick(stimuli.digit)
  ];

  const numTargets = Math.floor(
    (numTrials - 2) * CONFIG.nback_target_ratio
  );

  const available = Array.from(
    { length: numTrials - 2 },
    (_, index) => index + 2
  );

  const targets = new Set();

  for (let i = 0; i < numTargets; i++) {
    const selectedIndex = Math.floor(
      random01() * available.length
    );

    targets.add(
      available.splice(selectedIndex, 1)[0]
    );
  }

  for (let i = 2; i < numTrials; i++) {
    if (targets.has(i)) {
      seq[i] = seq[i - 2];
    } else {
      let digit = utils.pick(stimuli.digit);

      while (digit === seq[i - 2]) {
        digit = utils.pick(stimuli.digit);
      }

      seq[i] = digit;
    }
  }

  seq.forEach((digit, index) => {
    block.push(
      ...makeNBackTrial(
        digit,
        {
          phase: isPractice
            ? "practice_nback"
            : "nback_formal",

          trialInPhase: index
        },
        isPractice
      )
    );

    nback_history.push(digit);
  });

  return block;
}

// =============================================================================
// 生成正式图片区块
// probs 为各区段中“高音之后出现房屋”的概率。
// =============================================================================

function buildImageBlock(probs, segSize, phaseLabel) {
  const block = [];
  let index = 0;

  probs.forEach((pHigh) => {
    for (let i = 0; i < segSize; i++, index++) {
      const tone = random01() < 0.5
        ? "high"
        : "low";

      const pHouse = tone === "high"
        ? pHigh
        : 1 - pHigh;

      const category = random01() < pHouse
        ? stimuli.house
        : stimuli.face;

      const stimulus = utils.pick(category);

      block.push(
        ...makeImageTrial(
          stimulus,
          tone,
          {
            phase: phaseLabel,
            trialInBlock: index + 1
          }
        )
      );
    }
  });

  return block;
}

// =============================================================================
// 生成图片练习
// 保留原有练习设置：两类图片各半，使用每类第一张图片。
// =============================================================================

function buildImagePractice(numTrials) {
  const block = [];

  const list = jsPsych.randomization.shuffle([
    ...Array(Math.floor(numTrials / 2)).fill(stimuli.face[0]),
    ...Array(Math.ceil(numTrials / 2)).fill(stimuli.house[0])
  ]);

  list.forEach((stimulus, index) => {
    const tone = random01() < 0.5
      ? "high"
      : "low";

    block.push(
      ...makeImageTrial(
        stimulus,
        tone,
        {
          phase: "practice_image",
          trialInPhase: index
        }
      )
    );
  });

  return block;
}

// =============================================================================
// 指导语
// =============================================================================

const instructions = {
  overview: `
    <ol style="line-height:2.2;">
      <li>数字判断任务指导语与练习。</li>
      <li>图片预测任务指导语与练习。</li>
      <li>正式实验：先完成数字任务，再完成图片任务。</li>
    </ol>
  `,

  nback: `
    <p>
      你将看到一串依次出现的数字。
      请判断当前数字是否与往前数第 2 个数字相同。
    </p>

    <ul>
      <li>相同：按 <b>J</b>。</li>
      <li>不同：按 <b>F</b>。</li>
      <li>请尽量快速且准确地反应。</li>
    </ul>

    <p>
      例如：<b>2、7、2、5</b>。
      第三个数字 2 与第一个数字 2 相同，按 J；
      第四个数字 5 与第二个数字 7 不同，按 F。
    </p>

    <p>
      每次先呈现 300 毫秒注视点，再呈现数字。
      按键后结束当前反应阶段，最长等待 2000 毫秒。
      练习中会呈现 500 毫秒文字反馈。
    </p>
  `,

  image: `
    <p>
      听到声音后，请预测接下来出现的图片类型。
    </p>

    <ul>
      <li>预测人脸：按 <b>F</b>。</li>
      <li>预测房屋：按 <b>J</b>。</li>
      <li>请尽量快速且准确地反应。</li>
    </ul>

    <p><b>每个试次的流程：</b></p>

    <ol>
      <li>注视中央“＋”，同时聆听 300 毫秒的声音。</li>
      <li>声音结束后进行预测，最长有 3000 毫秒作答。</li>
      <li>按键后立即呈现真实图片，持续 300 毫秒。</li>
      <li>超时未作答，也会呈现真实图片。</li>
      <li>间隔 1.5–2.5 秒后，开始下一次。</li>
    </ol>

    <p>
      <b>练习反馈：</b>
      真实图片之后会显示 500 毫秒的文字。
      预测与真实图片一致时显示“正确”，
      不一致时显示“错误”，
      超时未作答时显示“无反应”。
      文字反馈结束后进入试次间隔。
    </p>

    <p>
      正式任务不显示这些文字反馈。
      请根据真实图片学习声音与图片之间的关系。
    </p>
  `
};

// =============================================================================
// 实验时间线：预加载、信息采集、总览
// =============================================================================

let timeline = [
  {
    type: jsPsychPreload,

    images: [
      ...stimuli.face,
      ...stimuli.house
    ],

    audio: [
      audio.high,
      audio.low
    ]
  },

  {
    type: jsPsychSurveyHtmlForm,

    html: `
      <div style="
        text-align:center;
        max-width:500px;
        margin:0 auto;
        color:black;
      ">
        <h2>个人信息</h2>

        <p style="text-align:left;">
          <label>
            被试编号：
            <input
              name="sub_id"
              type="text"
              required
              style="width:100%;"
            >
          </label>
        </p>

        <p style="text-align:left;">
          <label>
            年龄：
            <input
              name="age"
              type="number"
              min="18"
              required
              style="width:100%;"
            >
          </label>
        </p>

        <p style="text-align:left;">
          <label>
            性别：
            <select
              name="gender"
              required
              style="width:100%;"
            >
              <option value="">请选择</option>
              <option value="男性">男性</option>
              <option value="女性">女性</option>
            </select>
          </label>
        </p>
      </div>
    `,

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

  templates.instruction(
    "实验流程总览",
    instructions.overview,
    "下一页"
  )
];

// =============================================================================
// 练习流程：最多三轮，由被试选择是否再练一次
// =============================================================================

function addPracticeLoop(
  taskName,
  buildFunc,
  numRounds = CONFIG.max_practice_rounds
) {
  timeline.push(
    templates.instruction(
      taskName,
      taskName.includes("数字判断任务")
        ? instructions.nback
        : instructions.image,
      "进入练习"
    )
  );

  for (let round = 1; round <= numRounds; round++) {
    timeline.push({
      timeline: [
        ...buildFunc(),
        templates.practiceEnd(
          taskName,
          round === numRounds
        )
      ],

      conditional_function: () => {
        return (
          round === 1 ||
          (
            repeat_practice &&
            practice_round <= CONFIG.max_practice_rounds
          )
        );
      }
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

addPracticeLoop(
  "数字判断任务",
  () => buildNBackBlock(
    CONFIG.nback_practice_trials,
    true
  )
);

addPracticeLoop(
  "图片预测任务",
  () => buildImagePractice(
    CONFIG.image_practice_trials
  )
);

// =============================================================================
// 正式实验开始提示
// =============================================================================

timeline.push({
  type: jsPsychHtmlKeyboardResponse,

  stimulus: `
    <div style="
      text-align:center;
      line-height:2.5;
      max-width:700px;
      margin:0 auto;
      color:white;
    ">
      <h2 style="font-size:28px;margin-bottom:30px;">
        准备开始正式实验
      </h2>

      <p>你已完成所有练习。</p>
      <p>接下来先完成数字任务，再完成图片任务。</p>

      <p style="margin-top:30px;">
        数字任务：<b>F = 不同，J = 相同</b>
      </p>

      <p>
        图片任务：<b>F = 人脸，J = 房屋</b>
      </p>

      <p>请保持注意力集中，快速准确地按键。</p>

      <p style="margin-top:40px;">
        按任意键继续
      </p>
    </div>
  `,

  choices: "ALL_KEYS"
});

// =============================================================================
// 正式数字任务：仅一段，共 32 试次
// =============================================================================

timeline.push(
  ...buildNBackBlock(
    CONFIG.nback_trials,
    false
  )
);

// =============================================================================
// 图片 Block 1：80 试次，稳定阶段
// 高音之后出现房屋的概率为 0.8。
// =============================================================================

timeline.push(
  ...buildImageBlock(
    [0.8],
    80,
    "image_block1"
  )
);

// =============================================================================
// 图片 Block 2：80 试次，每 20 试次改变概率
// =============================================================================

timeline.push(
  ...buildImageBlock(
    [0.1, 0.9, 0.1, 0.9],
    20,
    "image_block2"
  )
);

// =============================================================================
// 中间休息：不增加第二段数字任务
// =============================================================================

timeline.push({
  type: jsPsychHtmlKeyboardResponse,

  stimulus: `
    <div style="
      text-align:center;
      line-height:2.5;
      max-width:700px;
      margin:0 auto;
      color:white;
    ">
      <h2 style="font-size:32px;margin-bottom:40px;">
        中间休息
      </h2>

      <p style="font-size:20px;">
        请稍作休息，准备继续图片任务。
      </p>

      <p style="font-size:18px;">
        <b>F = 人脸；J = 房屋</b>
      </p>

      <p style="margin-top:40px;">
        准备好后按任意键继续
      </p>
    </div>
  `,

  choices: "ALL_KEYS"
});

// =============================================================================
// 图片 Block 3：80 试次，稳定阶段
// 高音之后出现房屋的概率为 0.2。
// =============================================================================

timeline.push(
  ...buildImageBlock(
    [0.2],
    80,
    "image_block3"
  )
);

// =============================================================================
// 图片 Block 4：80 试次，每 20 试次改变概率
// =============================================================================

timeline.push(
  ...buildImageBlock(
    [0.9, 0.1, 0.9, 0.1],
    20,
    "image_block4"
  )
);

// =============================================================================
// 启动实验
// =============================================================================

jsPsych.run(timeline);
