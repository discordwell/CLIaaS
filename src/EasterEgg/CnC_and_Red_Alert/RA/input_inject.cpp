/*
** Input injection for WASM builds.
** Provides exported C functions callable from JavaScript via Module._inject_*()
** to inject keyboard and mouse events into the game's input buffer.
** This bypasses SDL event handling and Asyncify constraints.
**
** Also provides autoplay mode: when enabled, modal dialogs (BGMessageBox)
** auto-dismiss immediately, allowing automated testing to progress past
** briefing screens without needing to inject input during Asyncify yields.
*/

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include "function.h"

extern void Update_Mouse_Pos(int x, int y);

/*
** Global autoplay flag. When non-zero, BGMessageBox returns immediately
** (as if OK was pressed). Set via set_autoplay(1) from JavaScript.
*/
int g_autoplay_mode = 0;

extern "C" {

/*
** set_autoplay: Enable/disable autoplay mode.
** When enabled (mode=1), modal dialogs auto-dismiss.
** Returns previous mode value.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int set_autoplay(int mode)
{
    int prev = g_autoplay_mode;
    g_autoplay_mode = mode;
    // Force GameInFocus=true so focus-wait loops don't block
    if (mode) GameInFocus = true;
    return prev;
}

/*
** inject_key: Inject a keyboard press+release into the game's input buffer.
** vk_code: VK_* code from keyboard.h (e.g., 40=VK_RETURN, 41=VK_ESCAPE)
** Returns 1 on success, 0 if Keyboard not initialized or buffer full.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_key(int vk_code)
{
    if (!Keyboard) return 0;

    // Put key press
    bool ok = Keyboard->Put(vk_code);
    if (!ok) return 0;

    // Put key release
    Keyboard->Put(vk_code | WWKEY_RLS_BIT);
    return 1;
}

/*
** inject_key_press: Inject only a key press (no release).
** Useful for keys that need to be held.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_key_press(int vk_code)
{
    if (!Keyboard) return 0;
    return Keyboard->Put(vk_code) ? 1 : 0;
}

/*
** inject_key_release: Inject only a key release.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_key_release(int vk_code)
{
    if (!Keyboard) return 0;
    return Keyboard->Put(vk_code | WWKEY_RLS_BIT) ? 1 : 0;
}

/*
** inject_mouse_click: Inject a mouse button click (press+release) at game coords.
** game_x: 0-319, game_y: 0-199
** button: 1=left, 2=right
** Returns 1 on success, 0 on failure.
**
** Buffer protocol: 3 entries per event (button_code, x, y).
** WWKeyboardClass::Get() reads entries 1,2 as MouseQX/MouseQY when it
** detects a mouse button event (Is_Mouse_Key). So a full click = 6 entries.
** We also set MouseQX/MouseQY directly as a belt-and-suspenders measure.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_mouse_click(int game_x, int game_y, int button)
{
    if (!Keyboard) return 0;

    int vk = (button == 2) ? VK_RBUTTON : VK_LBUTTON;

    // Update mouse position for Get_Mouse_X/Y and queued click coords
    Update_Mouse_Pos(game_x, game_y);
    Keyboard->MouseQX = game_x;
    Keyboard->MouseQY = game_y;

    // Mouse press: button code + x + y (3-entry protocol for Get())
    if (!Keyboard->Put(vk)) return 0;
    Keyboard->Put(game_x);
    Keyboard->Put(game_y);

    // Mouse release: button code | RLS_BIT + x + y
    Keyboard->Put(vk | WWKEY_RLS_BIT);
    Keyboard->Put(game_x);
    Keyboard->Put(game_y);

    return 1;
}

/*
** inject_mouse_press: Inject only a mouse button press at game coords.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_mouse_press(int game_x, int game_y, int button)
{
    if (!Keyboard) return 0;

    int vk = (button == 2) ? VK_RBUTTON : VK_LBUTTON;
    Update_Mouse_Pos(game_x, game_y);
    Keyboard->MouseQX = game_x;
    Keyboard->MouseQY = game_y;

    if (!Keyboard->Put(vk)) return 0;
    Keyboard->Put(game_x);
    Keyboard->Put(game_y);
    return 1;
}

/*
** inject_mouse_release: Inject only a mouse button release at game coords.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_mouse_release(int game_x, int game_y, int button)
{
    if (!Keyboard) return 0;

    int vk = (button == 2) ? VK_RBUTTON : VK_LBUTTON;
    Update_Mouse_Pos(game_x, game_y);
    Keyboard->MouseQX = game_x;
    Keyboard->MouseQY = game_y;

    if (!Keyboard->Put(vk | WWKEY_RLS_BIT)) return 0;
    Keyboard->Put(game_x);
    Keyboard->Put(game_y);
    return 1;
}

/*
** inject_mouse_move: Update the mouse cursor position without clicking.
** game_x: 0-319, game_y: 0-199
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int inject_mouse_move(int game_x, int game_y)
{
    Update_Mouse_Pos(game_x, game_y);
    return 1;
}

/*
** input_diag: Return diagnostic info about the keyboard buffer.
** Returns: (tail << 16) | head, or -1 if Keyboard is null.
** Caller can extract: head = result & 0xFFFF, tail = (result >> 16) & 0xFFFF
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int input_diag(void)
{
    if (!Keyboard) return -1;

    // Access buffer state via Check() side effects — Head and Tail are private,
    // but we can probe: if Check() returns non-zero, there's data in buffer
    int has_data = Keyboard->Check() ? 1 : 0;
    return has_data;
}

} // extern "C"

// Main_Loop is a C++ function, must be called outside extern "C"
extern bool Main_Loop();

extern "C" {
/*
** autoplay_tick: Run one game frame. Called from JS setInterval.
** Returns 1 if game should end, 0 to continue.
*/
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int autoplay_tick(void)
{
    TimeQuake = false;
    bool done = Main_Loop();
    return done ? 1 : 0;
}
} // extern "C"
