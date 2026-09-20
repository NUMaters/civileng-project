package domain

import "errors"

var ErrInvalidOutput = errors.New("invalid_output")
var ErrLLMBusy = errors.New("llm_busy")
