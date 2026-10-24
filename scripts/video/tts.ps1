# Renders each narration segment to a WAV file with the built-in Windows voice.
param([string]$OutDir, [string]$Engine = 'Rebuttal')
Add-Type -AssemblyName System.Speech
$segments = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'narration.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($s in $segments) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice('Microsoft Zira Desktop')
  $synth.Rate = 1
  $synth.SetOutputToWaveFile((Join-Path $OutDir ($s.id + '.wav')))
  $synth.Speak($s.text.Replace('{{ENGINE}}', $Engine))
  $synth.Dispose()
}
