// Command signingvectors generates the EXO2-HMAC-SHA256 test vectors used by
// the TypeScript test suite (test/signing.test.ts).
//
// It implements the EXO2-HMAC-SHA256 request-signing scheme used by the
// Exoscale API with a fixed expiration and fixed credentials, printing the
// expected Authorization header values.
//
// Run: go run .
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	apiKey  = "test-key"
	secret  = "0123456789abcdef"
	expires = int64(1750000000)
)

func signRequest(req *http.Request) (string, error) {
	var (
		sigParts    []string
		headerParts []string
	)

	// Fixed expiration for deterministic vectors (clients sign with now + 10min).
	var expiration = time.Unix(expires, 0).UTC()

	// Request method/URL path
	sigParts = append(sigParts, fmt.Sprintf("%s %s", req.Method, req.URL.EscapedPath()))
	headerParts = append(headerParts, "EXO2-HMAC-SHA256 credential="+apiKey)

	// Request body if present
	body := ""
	if req.Body != nil {
		data, err := io.ReadAll(req.Body)
		if err != nil {
			return "", err
		}
		err = req.Body.Close()
		if err != nil {
			return "", err
		}
		body = string(data)
		req.Body = io.NopCloser(bytes.NewReader(data))
	}
	sigParts = append(sigParts, body)

	// Request query string parameters
	signedParams, paramsValues := extractRequestParameters(req)
	sigParts = append(sigParts, paramsValues)
	if len(signedParams) > 0 {
		headerParts = append(headerParts, "signed-query-args="+strings.Join(signedParams, ";"))
	}

	// Request headers -- none at the moment
	sigParts = append(sigParts, "")

	// Request expiration date (UNIX timestamp, no line return)
	sigParts = append(sigParts, fmt.Sprint(expiration.Unix()))
	headerParts = append(headerParts, "expires="+fmt.Sprint(expiration.Unix()))

	h := hmac.New(sha256.New, []byte(secret))
	if _, err := h.Write([]byte(strings.Join(sigParts, "\n"))); err != nil {
		return "", err
	}
	headerParts = append(headerParts, "signature="+base64.StdEncoding.EncodeToString(h.Sum(nil)))

	return strings.Join(headerParts, ","), nil
}

func extractRequestParameters(req *http.Request) ([]string, string) {
	var (
		names  []string
		values string
	)

	for param, values := range req.URL.Query() {
		if len(values) == 1 {
			names = append(names, param)
		}
	}
	sort.Strings(names)

	for _, param := range names {
		values += req.URL.Query().Get(param)
	}

	return names, values
}

func makeReq(method, target, body string) *http.Request {
	var req *http.Request
	var err error
	if body != "" {
		req, err = http.NewRequest(method, target, strings.NewReader(body))
	} else {
		req, err = http.NewRequest(method, target, nil)
	}
	if err != nil {
		panic(err)
	}
	return req
}

func main() {
	cases := []struct{ name, method, target, body string }{
		{"get-no-body-no-query", "GET", "/instance/0b12cb6b-7e3e-4c0e-9e10-1e5d8a7c4b2a", ""},
		{"get-query", "GET", "/instance?labels=web&manager-type=instance-pool", ""},
		{"get-query-encoding", "GET", "/instance?labels=a%20b", ""},
		{"post-body", "POST", "/instance", `{"disk-size":10,"name":"foo"}`},
		{"put-body-query", "PUT", "/instance/0b12cb6b-7e3e-4c0e-9e10-1e5d8a7c4b2a?include-deprecated=true", `{"tags":["a"]}`},
		{"delete-no-body", "DELETE", "/vpc/0b12cb6b-7e3e-4c0e-9e10-1e5d8a7c4b2a", ""},
	}
	for _, c := range cases {
		header, err := signRequest(makeReq(c.method, c.target, c.body))
		if err != nil {
			panic(err)
		}
		fmt.Printf("%s\t%s\n", c.name, header)
	}
}
