import { useState, useEffect } from 'react';

const STEPS = [
  { icon: '🔍', text: 'Analisando seu produto...' },
  { icon: '✍️', text: 'Otimizando título e descrição...' },
  { icon: '🎨', text: 'Gerando imagens profissionais...' },
  { icon: '⚡', text: 'Finalizando seus assets...' },
];

// Each step lasts ~25s to roughly match real API time
const STEP_DURATION = 25000;

export default function LoadingOverlay() {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Advance step every STEP_DURATION ms (but cap at last step)
    const stepTimer = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, STEP_DURATION);

    // Smooth progress bar — fills over total expected duration
    const totalDuration = STEP_DURATION * STEPS.length;
    const tick = 200; // ms per tick
    const increment = (tick / totalDuration) * 95; // never fully reaches 100 until done

    const progressTimer = setInterval(() => {
      setProgress((prev) => Math.min(prev + increment, 95));
    }, tick);

    return () => {
      clearInterval(stepTimer);
      clearInterval(progressTimer);
    };
  }, []);

  const step = STEPS[stepIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/95 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm mx-4 text-center">
        {/* Spinning icon */}
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-dark-600" />
          <div className="absolute inset-0 rounded-full border-4 border-t-shopee-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center text-3xl">
            {step.icon}
          </div>
        </div>

        {/* Step text */}
        <h3 className="text-xl font-bold text-white mb-2">{step.text}</h3>
        <p className="text-sm text-gray-500 mb-8">
          Isso pode levar até 2 minutos. Não feche a janela.
        </p>

        {/* Progress bar */}
        <div className="bg-dark-700 rounded-full h-2 overflow-hidden mb-4">
          <div
            className="h-full bg-shopee-500 rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? 'bg-shopee-500/20 text-shopee-400 font-medium'
                  : i < stepIndex
                  ? 'text-green-500'
                  : 'text-gray-700'
              }`}
            >
              <span>{s.icon}</span>
              <span className="hidden sm:inline">{i < stepIndex ? '✓' : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
